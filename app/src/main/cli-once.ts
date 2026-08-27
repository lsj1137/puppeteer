import { spawn } from 'node:child_process'
import type { DetectedRunner } from '@shared/session'
// 러너 실행 명령은 provider 공용이다(WSL·Windows 인용 규칙이 같다).
import { buildRunnerCommand } from './adapters/claude-cli'

/**
 * CLI 를 **한 번만** 돌려 최종 텍스트를 받는다.
 *
 * 세션을 만들지 않는 일회성 호출이다. 세션으로 돌리면 목록이 오염되고,
 * 그 세션이 다음 조회에 다시 잡힌다.
 *
 * provider 마다 비대화식 실행 방법이 달라 인자와 출력 해석을 나눈다.
 * Claude 는 `-p --output-format json`, Codex 는 `exec --json` (JSONL) 이다.
 * **양쪽 다 도구를 막는다** — 판단·작성만 시키므로 파일을 읽을 이유가 없고,
 * 승인 요청이 뜨면 화면이 멈춘 채 아무 결과도 못 낸다.
 */

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

const DISALLOWED = 'Bash Read Write Edit Glob Grep WebFetch WebSearch Task'

export interface RunOnceOptions {
  /** 비우면 CLI 기본 모델. 라우팅은 싼 모델로, 보고서는 사용자가 고른 모델로 돈다. */
  model?: string
  timeoutMs?: number
}

export function runOnce(
  prompt: string,
  runner: DetectedRunner,
  cwd: string,
  options: RunOnceOptions = {},
): Promise<string> {
  const { model, timeoutMs = 45_000 } = options
  const codex = runner.provider === 'codex-cli'
  const args = codex
    ? ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-']
    : [
        '-p',
        prompt,
        ...(model ? ['--model', model] : []),
        '--output-format',
        'json',
        '--disallowedTools',
        DISALLOWED,
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
    }, timeoutMs)

    // stdio 가 조건부라 타입상 nullable 이다. 위에서 둘 다 'pipe' 로 열지만 좁혀지지 않는다.
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => (out += c))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (c: string) => (err += c))
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
