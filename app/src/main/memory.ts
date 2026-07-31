import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DetectedRunner, MemoryEntry } from '@shared/session'
import { runnerEnvironmentLabel } from '@shared/runner'
import * as library from './agent-library'
import * as db from './db'

/**
 * Memory 편집.
 *
 * **CLI 가 실제로 읽는 파일이 정본이다**(기획서 11장). 앱이 별도 저장소를 두고
 * 세션 시작 시 주입하지 않는다 — 앱 밖에서 CLI 를 직접 실행해도 똑같이 적용돼야 한다.
 *
 * ```
 * global   <러너 홈>/.claude/CLAUDE.md
 * project  <프로젝트>/AGENTS.md   (+ CLAUDE.md 는 `@AGENTS.md` 한 줄로 연결)
 * auto     <러너 홈>/.claude/projects/<cwd 인코딩>/memory/*.md   ← 평소 쌓이는 그 메모리
 * agent    라이브러리 파일의 x-workspace.memory
 * ```
 *
 * **프로젝트 메모리는 `AGENTS.md` 를 정본으로 쓴다.** 실측 결과 Claude Code 는
 * `AGENTS.md` 를 그냥은 읽지 않지만 `CLAUDE.md` 안의 `@AGENTS.md` 임포트는 따라간다.
 * `AGENTS.md` 는 도구를 가리지 않는 이름이므로, 이렇게 두면 원본이 하나면서
 * Claude 와 다른 CLI 가 같은 파일을 읽는다.
 *
 * 전역·auto 는 **러너마다 홈이 다르다.** WSL 의 `~` 와 호스트 OS 의 홈은
 * 별개 파일이라 하나를 고쳐도 다른 쪽 세션에는 적용되지 않는다.
 *
 * `id` 는 파일 기반이면 `file:<절대경로>`, 에이전트면 `agent:<이름>` 이다.
 * 목록은 **내용을 담지 않는다** — auto 만 100개가 넘을 수 있어 매번 읽으면 낭비다.
 * 내용은 고른 항목만 `read()` 로 가져온다.
 */

const FILE = 'file:'
const AGENT = 'agent:'

/** 러너가 홈으로 쓰는 경로. WSL 은 UNC(`\\wsl.localhost\...`). */
function homeOf(r: DetectedRunner): string | undefined {
  return r.kind === 'wsl' ? r.home : homedir()
}

function entry(
  path: string,
  scope: MemoryEntry['scope'],
  label: string,
  readBy: MemoryEntry['readBy'] = 'claude',
): MemoryEntry {
  let exists = false
  let updatedAt: number | undefined
  try {
    if (existsSync(path)) {
      exists = true
      updatedAt = statSync(path).mtimeMs
    }
  } catch {
    // WSL 이 꺼져 있으면 UNC 접근이 실패한다 — 없는 것으로 두고 화면에서 알린다
  }
  return { id: FILE + path, scope, label, location: path, content: '', exists, updatedAt, readBy }
}

export function list(runners: DetectedRunner[], projects: string[]): MemoryEntry[] {
  const out: MemoryEntry[] = []
  const homes = new Map<string, DetectedRunner>()
  for (const r of runners) {
    const h = homeOf(r)
    if (h && !homes.has(h)) homes.set(h, r)
  }

  // 전역
  for (const [home, r] of homes) {
    out.push(
      entry(
        join(home, '.claude', 'CLAUDE.md'),
        'global',
        `전역 · ${runnerEnvironmentLabel(r)}`,
      ),
    )
  }

  // 프로젝트 — AGENTS.md 가 정본, CLAUDE.md 는 그리로 잇는다
  for (const p of projects) {
    const e = entry(join(p, 'AGENTS.md'), 'project', baseName(p), 'both')
    e.note = bridgeNote(join(p, 'CLAUDE.md'))
    out.push(e)
  }

  // 자동 메모리 — 홈마다 projects/*/memory 를 훑는다
  for (const home of homes.keys()) {
    for (const { dir, cwd } of autoRoots(home)) {
      for (const file of mdFiles(dir)) {
        const e = entry(join(dir, file), 'auto', file.replace(/\.md$/, ''))
        // MEMORY.md 는 색인이라 항상 위로 온다
        e.group = cwd
        out.push(e)
      }
    }
  }

  // 에이전트
  for (const a of library.list()) {
    const memory = a.workspace.memory ?? ''
    out.push({
      id: AGENT + a.name,
      scope: 'agent',
      label: a.name,
      location: `${a.filePath} · x-workspace.memory`,
      content: '',
      exists: memory.length > 0,
      // 앱이 실행할 때 프롬프트에 직접 붙이므로 어느 CLI 로 돌리든 적용된다
      readBy: 'both',
    })
  }

  return out
}

export function read(id: string): string {
  if (id.startsWith(AGENT)) return library.read(id.slice(AGENT.length))?.workspace.memory ?? ''
  const path = id.slice(FILE.length)
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  } catch {
    return ''
  }
}

export function save(id: string, content: string): boolean {
  if (id.startsWith(AGENT)) {
    const name = id.slice(AGENT.length)
    const agent = library.read(name)
    if (!agent) return false
    library.save({ ...agent, workspace: { ...agent.workspace, memory: content || undefined } })
  } else {
    const path = id.slice(FILE.length)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
    // AGENTS.md 를 저장했으면 Claude 가 따라올 다리를 놓아준다
    if (path.endsWith('AGENTS.md')) ensureBridge(join(dirname(path), 'CLAUDE.md'))
  }
  db.recordMemoryEdit(id, content.length)
  return true
}

const BRIDGE = '@AGENTS.md'

/** CLAUDE.md 가 AGENTS.md 를 가리키게 한다. 이미 다른 내용이 있으면 건드리지 않는다. */
function ensureBridge(claudePath: string): void {
  try {
    if (existsSync(claudePath) && readFileSync(claudePath, 'utf8').trim() !== '') return
    writeFileSync(claudePath, `${BRIDGE}\n`, 'utf8')
  } catch {
    // 못 만들어도 AGENTS.md 저장 자체는 성공이다
  }
}

/** Claude 가 이 프로젝트의 AGENTS.md 를 못 읽는 상태면 알려준다. */
function bridgeNote(claudePath: string): string | undefined {
  try {
    if (!existsSync(claudePath)) return undefined // 저장할 때 만들어진다
    const body = readFileSync(claudePath, 'utf8').trim()
    if (body === BRIDGE || body.includes(BRIDGE)) return undefined
    return 'CLAUDE.md 에 별도 내용이 있어 Claude 는 그쪽을 읽습니다. 한쪽으로 합치세요.'
  } catch {
    return undefined
  }
}

/**
 * `<home>/.claude/projects/*` 중 memory 가 있는 것들.
 *
 * 디렉터리 이름은 cwd 를 `[^a-zA-Z0-9] → -` 로 바꾼 것이라 **되돌릴 수 없다**
 * (한글 경로가 전부 `-` 가 된다). 그래서 이름을 해독하지 않고
 * 세션 기록(jsonl) 첫머리의 `cwd` 를 읽어 실제 경로를 알아낸다.
 */
function autoRoots(home: string): { dir: string; cwd: string }[] {
  const root = join(home, '.claude', 'projects')
  const out: { dir: string; cwd: string }[] = []
  let names: string[] = []
  try {
    names = readdirSync(root)
  } catch {
    return out
  }

  for (const name of names) {
    const dir = join(root, name, 'memory')
    try {
      if (!existsSync(dir)) continue
    } catch {
      continue
    }
    out.push({ dir, cwd: resolveCwd(join(root, name)) ?? name })
  }
  return out
}

/** 세션 기록에서 실제 작업 경로를 캐낸다. 못 찾으면 undefined. */
function resolveCwd(projectDir: string): string | undefined {
  try {
    const logs = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'))
    for (const f of logs.slice(0, 3)) {
      const head = readFileSync(join(projectDir, f), 'utf8').slice(0, 4000)
      const m = head.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      if (m) return JSON.parse(`"${m[1]}"`) as string
    }
  } catch {
    // 기록이 없거나 읽을 수 없으면 디렉터리 이름을 쓴다
  }
  return undefined
}

function mdFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort((a, b) => {
        if (a === 'MEMORY.md') return -1
        if (b === 'MEMORY.md') return 1
        return a.localeCompare(b)
      })
  } catch {
    return []
  }
}

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
