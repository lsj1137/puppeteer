import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { AgentDef } from '@shared/session'

/**
 * Project Agent 는 Claude Code 정본 위치에 저장한다.
 *
 *   <project>/.claude/agents/<name>.md
 *
 * 앱이 없어도 `claude --agent <name>` 으로 그대로 쓰이고, 파일 하나만 옮기면 공유된다.
 * 앱 전용 설정은 표준 필드를 건드리지 않도록 `x-workspace` 아래에 둔다.
 */

const dirOf = (projectPath: string): string => join(projectPath, '.claude', 'agents')

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function listAgents(projectPath: string): AgentDef[] {
  const dir = dirOf(projectPath)
  if (!existsSync(dir)) return []

  const out: AgentDef[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue
    try {
      const agent = readAgent(projectPath, file.slice(0, -3))
      if (agent) out.push(agent)
    } catch {
      // 깨진 파일은 건너뛴다
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function readAgent(projectPath: string, name: string): AgentDef | undefined {
  const path = join(dirOf(projectPath), `${name}.md`)
  if (!existsSync(path)) return undefined

  const raw = readFileSync(path, 'utf8')
  const m = FRONTMATTER.exec(raw)
  if (!m) return undefined

  const fm = (parse(m[1]) ?? {}) as Record<string, unknown>
  const ws = (fm['x-workspace'] ?? {}) as Record<string, unknown>

  return {
    name: String(fm.name ?? name),
    description: String(fm.description ?? ''),
    instructions: (m[2] ?? '').trim(),
    model: typeof fm.model === 'string' ? fm.model : undefined,
    tools: typeof fm.tools === 'string' ? fm.tools : undefined,
    projectPath,
    filePath: path,
    workspace: {
      readPaths: toStringArray(ws.readPaths),
      writePaths: toStringArray(ws.writePaths),
      allowedTools: toStringArray(ws.allowedTools),
      disallowedTools: toStringArray(ws.disallowedTools),
      completion: typeof ws.completion === 'string' ? ws.completion : undefined,
      worktree: typeof ws.worktree === 'string' ? ws.worktree : undefined,
    },
  }
}

export function saveAgent(agent: AgentDef): string {
  const dir = dirOf(agent.projectPath)
  mkdirSync(dir, { recursive: true })

  // Claude Code 표준 필드가 먼저 오도록 순서를 고정한다
  const fm: Record<string, unknown> = {
    name: agent.name,
    description: agent.description,
  }
  if (agent.model) fm.model = agent.model
  if (agent.tools) fm.tools = agent.tools

  const ws = clean(agent.workspace as unknown as Record<string, unknown>)
  if (Object.keys(ws).length) fm['x-workspace'] = ws

  const path = join(dir, `${agent.name}.md`)
  writeFileSync(path, `---\n${stringify(fm).trim()}\n---\n\n${agent.instructions.trim()}\n`, 'utf8')
  return path
}

export function deleteAgent(projectPath: string, name: string): void {
  rmSync(join(dirOf(projectPath), `${name}.md`), { force: true })
}

function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const arr = v.filter((x): x is string => typeof x === 'string')
  return arr.length ? arr : undefined
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
