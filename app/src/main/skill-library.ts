import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import { parse, stringify } from 'yaml'
import type { AgentDef, SkillDef, SkillImportPreview, SkillScope, SkillState } from '@shared/session'
import { applySkillStates, mergeSkillsBySpecificity } from '@shared/skills'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
const safeName = (name: string): boolean => /^[A-Za-z0-9가-힣_-]+$/.test(name)

/** Windows 편집기의 BOM과 채팅 예시를 통째로 저장한 바깥 Markdown fence를 제거한다. */
function normalizeSkillMarkdown(raw: string): string {
  let normalized = raw.replace(/^\uFEFF/, '')
  const fenced = /^\s*```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(normalized)
  if (fenced) normalized = fenced[1]
  return normalized.trimStart()
}

function root(scope: SkillScope, projectPath?: string, agentName?: string): string {
  if (scope === 'project') {
    if (!projectPath) throw new Error('Project Skill에는 프로젝트가 필요합니다.')
    return join(projectPath, '.agents', 'skills')
  }
  if (scope === 'agent') {
    if (!agentName) throw new Error('Agent Skill에는 에이전트가 필요합니다.')
    return join(app.getPath('userData'), 'skills', 'agents', agentName)
  }
  return join(app.getPath('userData'), 'skills', 'global')
}

function idOf(scope: SkillScope, name: string, projectPath?: string, agentName?: string): string {
  return [scope, projectPath ?? '', agentName ?? '', name].join(':')
}

function parseFile(
  path: string,
  scope: SkillScope,
  projectPath?: string,
  agentName?: string,
): SkillDef | undefined {
  try {
    const raw = normalizeSkillMarkdown(readFileSync(path, 'utf8'))
    const match = FRONTMATTER.exec(raw)
    if (!match) return undefined
    const fm = (parse(match[1]) ?? {}) as Record<string, unknown>
    const fallback = path.split(/[\\/]/).slice(-2, -1)[0] ?? ''
    const name = String(fm.name ?? fallback).trim()
    if (!name) return undefined
    return {
      id: idOf(scope, name, projectPath, agentName),
      name,
      description: String(fm.description ?? ''),
      scope,
      location: path,
      content: (match[2] ?? '').trim(),
      projectPath,
      agentName,
    }
  } catch {
    return undefined
  }
}

/** 외부 SKILL.md를 파싱만 한다. 저장 범위와 정본 생성은 사용자가 검토한 뒤 결정한다. */
export function previewImport(path: string): SkillImportPreview {
  const raw = normalizeSkillMarkdown(readFileSync(path, 'utf8'))
  const match = FRONTMATTER.exec(raw)
  if (!match) throw new Error('SKILL.md frontmatter(---)를 찾지 못했습니다.')
  const fm = (parse(match[1]) ?? {}) as Record<string, unknown>
  const fallback = path.split(/[\\/]/).slice(-2, -1)[0] ?? ''
  const name = String(fm.name ?? fallback).trim()
  if (!name) throw new Error('Skill 이름을 확인하지 못했습니다.')
  const known = new Set(['name', 'description'])
  const ignoredFrontmatter = Object.keys(fm).filter((key) => !known.has(key))
  const normalizedPath = path.replace(/\\/g, '/').toLowerCase()
  return {
    sourcePath: path,
    sourceFormat: normalizedPath.includes('/.codex/skills/') || normalizedPath.endsWith('/skill.md')
      ? 'codex-skill'
      : 'generic-skill',
    skill: {
      name,
      description: String(fm.description ?? ''),
      content: (match[2] ?? '').trim(),
    },
    ignoredFrontmatter,
  }
}

function scan(scope: SkillScope, projectPath?: string, agentName?: string): SkillDef[] {
  const dir = root(scope, projectPath, agentName)
  if (!existsSync(dir)) return []
  const out: SkillDef[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name, 'SKILL.md')
    if (!existsSync(path)) continue
    const skill = parseFile(path, scope, projectPath, agentName)
    if (skill) out.push(skill)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function list(projects: string[], agents: string[]): SkillDef[] {
  return [
    ...scan('global'),
    ...projects.flatMap((path) => scan('project', path)),
    ...agents.flatMap((name) => scan('agent', undefined, name)),
  ]
}

export function save(skill: SkillDef): SkillDef {
  const name = skill.name.trim()
  if (!safeName(name)) throw new Error('Skill 이름에 공백과 특수문자는 쓸 수 없습니다.')
  const path = join(root(skill.scope, skill.projectPath, skill.agentName), name, 'SKILL.md')
  if (existsSync(path) && (!skill.location || resolve(skill.location) !== resolve(path))) {
    throw new Error(`같은 범위에 «${name}» Skill이 이미 있습니다.`)
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, serialize(skill, name), 'utf8')
  return { ...skill, id: idOf(skill.scope, name, skill.projectPath, skill.agentName), name, location: path }
}

function serialize(skill: Pick<SkillDef, 'name' | 'description' | 'content'>, name = skill.name.trim()): string {
  const fm = stringify({ name, description: skill.description.trim() }).trim()
  return `---\n${fm}\n---\n\n${skill.content.trim()}\n`
}

/** 범위 변경은 새 정본을 먼저 만든 뒤 기존 정본을 제거한다. */
export function move(previous: SkillDef, next: SkillDef): SkillDef {
  const saved = save({ ...next, location: '' })
  try {
    remove(previous)
  } catch (error) {
    remove(saved)
    throw error
  }
  return saved
}

export function exportFile(skill: SkillDef, destination: string): void {
  writeFileSync(destination, serialize(skill), 'utf8')
}

export function remove(skill: Pick<SkillDef, 'scope' | 'name' | 'projectPath' | 'agentName'>): void {
  if (!safeName(skill.name)) return
  rmSync(join(root(skill.scope, skill.projectPath, skill.agentName), skill.name), {
    recursive: true,
    force: true,
  })
}

/** 이름 충돌은 더 구체적인 범위가 이긴다. */
export function resolve(projectPath: string, agent?: AgentDef): Array<SkillDef & { state: SkillState }> {
  return applySkillStates(mergeSkillsBySpecificity(
    scan('global'),
    scan('project', projectPath),
    agent ? scan('agent', undefined, agent.name) : [],
  ), agent?.workspace.skills)
}

export function prompt(
  projectPath: string,
  agent?: AgentDef,
  pathMap: (path: string) => string = (path) => path,
): string | undefined {
  const skills = resolve(projectPath, agent)
  if (!skills.length) return undefined
  const required = skills.filter((skill) => skill.state === 'required')
  const available = skills.filter((skill) => skill.state === 'available')
  const parts = ['# Skills']
  if (required.length) {
    parts.push('아래 Required Skill은 이 작업에 항상 적용하세요.')
    for (const skill of required) {
      parts.push(`## ${skill.name} (Required)\n${skill.content}`)
    }
  }
  if (available.length) {
    parts.push('필요할 때만 아래 Available Skill의 SKILL.md를 읽고 따르세요.')
    for (const skill of available) {
      parts.push(`- ${skill.name}: ${skill.description || '(설명 없음)'} — ${pathMap(skill.location)}`)
    }
  }
  return parts.join('\n\n')
}
