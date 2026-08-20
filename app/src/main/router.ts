import { spawn } from 'node:child_process'
import type { DetectedRunner, RouteCandidate, RouteResult } from '@shared/session'
// 러너 실행 명령은 provider 공용이다(WSL·Windows 인용 규칙이 같다).
import { buildRunnerCommand } from './adapters/claude-cli'
import * as library from './agent-library'
import * as db from './db'

/**
 * 홈에서 받은 지시를 어느 프로젝트의 어느 Agent 에게 보낼지 정한다.
 *
 * 1) 등록된 전 프로젝트의 Agent 를 모은다
 * 2) 후보가 0~1개면 모델을 부르지 않는다 (돈과 시간 낭비)
 * 3) 후보가 여럿이면 haiku 한 번으로 고른다 — 판단만 시키고 도구는 주지 않는다
 *
 * 어떤 경우에도 곧바로 실행하지 않는다. 결과는 렌더러가 확인 카드로 띄운다.
 */

const ROUTER_MODEL = 'claude-haiku-4-5'
const TIMEOUT_MS = 45_000

/**
 * 후보는 에이전트 단위다. 예전처럼 (프로젝트 × 에이전트) 로 펼치지 않는다 —
 * 같은 에이전트가 여러 번 뜨면 모델이 고르기만 어려워진다.
 * 어느 프로젝트에서 돌릴지는 확인 카드에서 정한다.
 */
export function collectCandidates(): RouteCandidate[] {
  const registered = db.listProjects().map((p) => p.path)
  return library.list().map((a) => ({
    agentName: a.name,
    description: a.description,
    // 적용 대상이 비어 있으면 전체 허용. 등록이 풀린 경로는 걸러낸다.
    projects: a.workspace.projects?.length
      ? a.workspace.projects.filter((p) => registered.includes(p))
      : registered,
  }))
}

export async function route(
  instruction: string,
  runner: DetectedRunner,
  cwd: string,
): Promise<RouteResult> {
  const candidates = collectCandidates()

  if (candidates.length === 0) {
    return { candidates, reason: '등록된 프로젝트에 에이전트가 없습니다.' }
  }
  if (candidates.length === 1) {
    return {
      candidates,
      pick: candidates[0],
      reason: '후보가 하나뿐이라 모델을 거치지 않았습니다.',
    }
  }

  const list = candidates
    .map((c, i) => `${i + 1}. ${c.agentName} — ${c.description || '(설명 없음)'}`)
    .join('\n')

  const prompt = `아래는 사용자의 지시와, 실행 가능한 에이전트 목록이다.
지시를 가장 잘 처리할 에이전트를 하나 고르라.

지시:
"""
${instruction}
"""

에이전트:
${list}

규칙:
- 도구를 쓰지 마라. 파일을 읽지 마라. 목록만 보고 판단한다.
- 적합한 에이전트가 없으면 index 를 0 으로 한다. 억지로 고르지 마라.
- reason 은 한국어 한 문장.

JSON 만 출력한다. 다른 말은 붙이지 마라.
{"index": <번호 또는 0>, "reason": "<이유>"}`

  let raw: string
  try {
    raw = await runOnce(prompt, runner, cwd)
  } catch (e) {
    return { candidates, reason: `라우팅 실패: ${(e as Error).message}` }
  }

  const parsed = parseDecision(raw)
  if (!parsed) return { candidates, reason: `라우터 응답을 해석하지 못했습니다: ${raw.slice(0, 120)}` }

  const pick = parsed.index >= 1 && parsed.index <= candidates.length
    ? candidates[parsed.index - 1]
    : undefined
  return { candidates, pick, reason: parsed.reason }
}

/** `--output-format json` 은 {result: "..."} 로 감싸서 준다. */
export function claudeResult(out: string): string {
  try {
    const o = JSON.parse(out) as { result?: unknown }
    return typeof o.result === 'string' ? o.result : out
  } catch {
    return out
  }
}

/**
 * `codex exec --json` 은 JSONL 을 흘린다. 마지막 agent_message 가 최종 응답이다.
 * 못 찾으면 원문을 그대로 돌려 상위에서 «해석하지 못했습니다» 로 드러나게 한다.
 */
export function lastCodexMessage(out: string): string {
  let text = ''
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const event = JSON.parse(trimmed) as { item?: { type?: string; text?: string } }
      if (event.item?.type === 'agent_message' && event.item.text) text = event.item.text
    } catch {
      // 부분 줄은 건너뛴다
    }
  }
  return text || out
}

/** 모델이 코드 펜스나 인사말을 섞어 보내도 JSON 만 건져낸다. */
function parseDecision(text: string): { index: number; reason: string } | undefined {
  const m = text.match(/\{[\s\S]*?"index"[\s\S]*?\}/)
  if (!m) return undefined
  try {
    const o = JSON.parse(m[0]) as { index?: unknown; reason?: unknown }
    const index = Number(o.index)
    if (!Number.isFinite(index)) return undefined
    return { index, reason: typeof o.reason === 'string' ? o.reason : '' }
  } catch {
    return undefined
  }
}

/**
 * CLI 를 한 번만 돌려 최종 텍스트를 받는다.
 *
 * provider 마다 비대화식 실행 방법이 달라 인자와 출력 해석을 나눈다.
 * Claude 는 `-p --output-format json`, Codex 는 `exec --json` (JSONL) 이다.
 * 판단만 시키므로 양쪽 다 도구를 막는다 — 승인 요청이 뜨면 화면이 멈춘다.
 */
function runOnce(prompt: string, runner: DetectedRunner, cwd: string): Promise<string> {
  const codex = runner.provider === 'codex-cli'
  const args = codex
    ? ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-']
    : [
        '-p',
        prompt,
        '--model',
        ROUTER_MODEL,
        '--output-format',
        'json',
        '--disallowedTools',
        'Bash Read Write Edit Glob Grep WebFetch WebSearch Task',
      ]
  const { command, args: full, windowsVerbatimArguments } = buildRunnerCommand(runner, cwd, args)

  return new Promise((resolve, reject) => {
    const child = spawn(command, full, {
      cwd: runner.kind === 'wsl' ? undefined : cwd,
      // Codex 는 프롬프트를 stdin 으로 받는다. 명령행 길이·따옴표 문제를 피한다.
      stdio: [codex ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments,
    })
    if (codex) {
      child.stdin?.end(prompt, 'utf8')
    }

    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('시간 초과'))
    }, TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c: string) => (out += c))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => (err += c))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !out.trim()) {
        reject(new Error(err.trim().split('\n').pop() || `exit ${code}`))
        return
      }
      resolve(codex ? lastCodexMessage(out) : claudeResult(out))
    })
  })
}
