import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { parse, stringify } from 'yaml'
import type { AgentDef, AgentSource, ProviderId } from '@shared/session'

/**
 * 에이전트 전역 라이브러리.
 *
 *   <userData>/agents/<name>.md
 *
 * 프로젝트마다 흩어두지 않고 한곳에서 관리한다. 실행할 때는 파일을 배치하는 대신
 * CLI 에 `--agents <json>` 으로 정의를 통째로 넘긴다(`--agent <name>` 으로 선택).
 * 덕분에 러너(WSL/Windows)마다 홈 디렉터리가 다른 문제도 생기지 않는다.
 *
 * 형식은 Claude Code 표준 프론트매터를 그대로 쓴다 — 내보내면 그 자리에서 바로 동작한다.
 */

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function libraryDir(): string {
  const dir = join(app.getPath('userData'), 'agents')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function list(): AgentDef[] {
  const dir = libraryDir()
  const out: AgentDef[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue
    const agent = parseFile(join(dir, file), 'library')
    if (agent) out.push(agent)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function read(name: string): AgentDef | undefined {
  return parseFile(join(libraryDir(), `${name}.md`), 'library')
}

export function save(agent: AgentDef): string {
  const path = join(libraryDir(), `${agent.name}.md`)
  writeFileSync(path, serialize(agent), 'utf8')
  return path
}

export function remove(name: string): void {
  rmSync(join(libraryDir(), `${name}.md`), { force: true })
}

/**
 * 프로젝트의 `.claude/agents` 에 있던 파일을 라이브러리로 옮긴다.
 * 복사가 아니라 이동이다 — 같은 이름이 두 곳에 남으면 어느 쪽이 정본인지 알 수 없다.
 */
export function importFrom(projectPath: string, name: string): AgentDef | undefined {
  const src = join(projectPath, '.claude', 'agents', `${name}.md`)
  const agent = parseFile(src, 'project', projectPath)
  if (!agent) return undefined

  // 원본이 있던 프로젝트를 적용 대상 기본값으로 잡아준다
  const projects = agent.workspace.projects?.length ? agent.workspace.projects : [projectPath]
  const moved: AgentDef = {
    ...agent,
    scope: 'library',
    projectPath: undefined,
    workspace: { ...agent.workspace, projects },
  }
  const dest = save(moved)
  rmSync(src, { force: true })
  return { ...moved, filePath: dest }
}

/** 프로젝트에 남아 있는 .claude/agents 파일들 — 가져오기 후보로만 쓴다. */
export function scanProject(projectPath: string): AgentDef[] {
  const dir = join(projectPath, '.claude', 'agents')
  if (!existsSync(dir)) return []
  const out: AgentDef[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue
    const agent = parseFile(join(dir, file), 'project', projectPath)
    if (agent) out.push(agent)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** 라이브러리 에이전트를 프로젝트에 파일로 내보낸다 (앱 없이 쓰려는 경우). */
export type AgentExportFormat = 'claude-agent' | 'codex-skill'

export function exportTo(
  name: string,
  projectPath: string,
  format: AgentExportFormat = 'claude-agent',
): string | undefined {
  const agent = read(name)
  if (!agent) return undefined

  if (format === 'codex-skill') {
    const dir = join(projectPath, '.agents', 'skills', agent.name)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'SKILL.md')
    const frontmatter = stringify({
      name: agent.name,
      description: agent.description,
    }).trim()
    writeFileSync(path, `---\n${frontmatter}\n---\n\n${agent.instructions.trim()}\n`, 'utf8')
    return path
  }

  const dir = join(projectPath, '.claude', 'agents')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}.md`)
  writeFileSync(path, serialize(agent), 'utf8')
  return path
}

/** 파일 선택 대화상자 등에서 고른 임의 위치로 Agent를 내보낸다. */
export function exportFile(
  name: string,
  path: string,
  format: AgentExportFormat = 'claude-agent',
): string | undefined {
  const agent = read(name)
  if (!agent) return undefined
  mkdirSync(dirname(path), { recursive: true })
  if (format === 'codex-skill') {
    const frontmatter = stringify({
      name: agent.name,
      description: agent.description,
    }).trim()
    writeFileSync(path, `---\n${frontmatter}\n---\n\n${agent.instructions.trim()}\n`, 'utf8')
  } else {
    writeFileSync(path, serialize(agent), 'utf8')
  }
  return path
}

/**
 * CLI `--agents` 에 넘길 JSON.
 * 정의를 인라인으로 주므로 파일이 어디에 있든 상관없다.
 */
export function toCliAgents(agent: AgentDef): string {
  // Agent Memory 는 지침 뒤에 붙인다 — 지침이 역할이라면 메모리는 그 역할이 기억할 것들이다
  const memory = agent.workspace.memory?.trim()
  const def: Record<string, unknown> = {
    description: agent.description,
    prompt: memory ? `${agent.instructions}\n\n## 기억해 둘 것\n\n${memory}` : agent.instructions,
  }
  if (agent.model) def.model = agent.model
  const tools = agent.workspace.allowedTools
  if (tools?.length) def.tools = tools
  return JSON.stringify({ [agent.name]: def })
}

/**
 * `--agents` 를 못 쓰는 CLI 용. 지침을 프롬프트 앞에 붙일 형태로 만든다.
 * 인라인 정의와 같은 내용이어야 두 러너의 동작이 갈리지 않는다.
 */
export function toPromptPrefix(agent: AgentDef): string {
  const memory = agent.workspace.memory?.trim()
  const body = memory
    ? `${agent.instructions}\n\n## 기억해 둘 것\n\n${memory}`
    : agent.instructions
  return `# 역할: ${agent.name}\n\n${body}`
}

/** 적용 대상이 비어 있으면 전체 허용으로 본다. */
export function appliesTo(agent: AgentDef, projectPath: string): boolean {
  const scope = agent.workspace.projects
  return !scope?.length || scope.includes(projectPath)
}

/**
 * 선언은 됐지만 실행에서 강제되지 않는 경로 범위.
 *
 * `readPaths`·`writePaths` 는 파싱·재연결 치환만 하고 도구 실행 경로에서는 아무도 보지 않는다.
 * 특히 읽기는 승인 훅 대상이 아니라(`Read`·`Glob`·`Grep` 은 일부러 가로채지 않는다)
 * 구조적으로 검사할 지점 자체가 없다. 경계를 걸었다고 믿게 두는 편이 기능이 없는 것보다 나쁘므로
 * 세션 시작 때 무엇이 안 걸리는지 알린다.
 */
export function unenforcedPathScopes(agent: AgentDef): string[] {
  const unenforced: string[] = []
  if (agent.workspace.readPaths?.length) unenforced.push('readPaths')
  if (agent.workspace.writePaths?.length) unenforced.push('writePaths')
  return unenforced
}

/**
 * 이 에이전트를 그 provider 로 돌려도 되는지.
 * 지침 전문이 그대로 모델에 실려 나가므로, 제한을 걸어 둔 에이전트는 막는다.
 */
export function allowsProvider(agent: AgentDef, provider: ProviderId): boolean {
  const list = agent.workspace.providers
  return !list?.length || list.includes(provider)
}

function serialize(agent: AgentDef): string {
  // Claude Code 표준 필드가 먼저 오도록 순서를 고정한다
  const fm: Record<string, unknown> = { name: agent.name, description: agent.description }
  if (agent.model) fm.model = agent.model
  if (agent.tools) fm.tools = agent.tools

  const ws = clean(agent.workspace as unknown as Record<string, unknown>)
  if (Object.keys(ws).length) fm['x-workspace'] = ws

  return `---\n${stringify(fm).trim()}\n---\n\n${agent.instructions.trim()}\n`
}

function parseFile(
  path: string,
  scope: 'library' | 'project',
  projectPath?: string,
): AgentDef | undefined {
  if (!existsSync(path)) return undefined
  try {
    return parseAgentText(readFileSync(path, 'utf8'), path, scope, projectPath)
  } catch {
    return undefined // 깨진 파일은 건너뛴다
  }
}

/** 프론트매터 + 본문 텍스트를 AgentDef 로. 파일·URL·붙여넣기가 같은 경로를 탄다. */
export function parseAgentText(
  raw: string,
  path = '',
  scope: 'library' | 'project' = 'library',
  projectPath?: string,
): AgentDef | undefined {
  {
    const m = FRONTMATTER.exec(raw)
    if (!m) return undefined
    const fm = (parse(m[1]) ?? {}) as Record<string, unknown>
    const ws = (fm['x-workspace'] ?? {}) as Record<string, unknown>
    const fallback = path.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? ''

    return {
      name: String(fm.name ?? fallback),
      description: String(fm.description ?? ''),
      instructions: (m[2] ?? '').trim(),
      model: typeof fm.model === 'string' ? fm.model : undefined,
      tools: typeof fm.tools === 'string' ? fm.tools : undefined,
      filePath: path,
      scope,
      projectPath,
      workspace: {
        readPaths: strings(ws.readPaths),
        writePaths: strings(ws.writePaths),
        allowedTools: strings(ws.allowedTools),
        disallowedTools: strings(ws.disallowedTools),
        projects: strings(ws.projects),
        source: parseSource(ws.source),
        memory: typeof ws.memory === 'string' ? ws.memory : undefined,
        providers: strings(ws.providers) as AgentDef['workspace']['providers'],
        completion: typeof ws.completion === 'string' ? ws.completion : undefined,
        worktree: typeof ws.worktree === 'string' ? ws.worktree : undefined,
        skills: skillStates(ws.skills),
      },
    }
  }
}

/** x-workspace.source — url 이 없으면 연결로 치지 않는다 */
function parseSource(v: unknown): AgentSource | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.url !== 'string' || !o.url) return undefined
  return {
    url: o.url,
    hash: typeof o.hash === 'string' ? o.hash : '',
    checkedAt: typeof o.checkedAt === 'number' ? o.checkedAt : undefined,
  }
}

function strings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const arr = v.filter((x): x is string => typeof x === 'string')
  return arr.length ? arr : undefined
}

/** 라이브러리 Agent에 저장된 프로젝트 및 프로젝트 내부 절대경로를 새 위치로 옮긴다. */
export function relinkProject(oldPath: string, newPath: string): number {
  const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  const oldKey = normalize(oldPath)
  const replace = (value: string): string => {
    const key = normalize(value)
    if (key === oldKey) return newPath
    if (!key.startsWith(`${oldKey}/`)) return value
    return newPath + value.slice(oldPath.length)
  }

  let changed = 0
  for (const agent of list()) {
    const projects = agent.workspace.projects?.map(replace)
    const readPaths = agent.workspace.readPaths?.map(replace)
    const writePaths = agent.workspace.writePaths?.map(replace)
    if (
      JSON.stringify(projects) === JSON.stringify(agent.workspace.projects)
      && JSON.stringify(readPaths) === JSON.stringify(agent.workspace.readPaths)
      && JSON.stringify(writePaths) === JSON.stringify(agent.workspace.writePaths)
    ) continue
    save({
      ...agent,
      workspace: { ...agent.workspace, projects, readPaths, writePaths },
    })
    changed++
  }
  return changed
}

function skillStates(v: unknown): AgentDef['workspace']['skills'] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: NonNullable<AgentDef['workspace']['skills']> = {}
  for (const [name, state] of Object.entries(v as Record<string, unknown>)) {
    if (state === 'required' || state === 'available' || state === 'disabled') out[name] = state
  }
  return Object.keys(out).length ? out : undefined
}

/** undefined / 빈 값 제거 — 안 쓰는 키를 파일에 남기지 않는다 */
function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'string' && !v.trim()) continue
    out[k] = v
  }
  return out
}
