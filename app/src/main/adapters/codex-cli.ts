import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import type { SessionEvent, SessionStatus } from '@shared/session'
import { buildRunnerCommand, type StartOptions } from './claude-cli'

/**
 * Codex CLI 어댑터. `codex exec --json` 의 JSONL 을 앱 이벤트로 정규화한다.
 *
 * Claude 와 다른 점만 적어 둔다 (같은 부분은 claude-cli.ts 주석 참고).
 *
 * - 이벤트 이름이 `thread.*` / `turn.*` / `item.*` 이다.
 * - **비용(USD)을 주지 않는다.** `turn.completed.usage` 는 토큰 수뿐이라 앱이 환산해야 한다.
 * - 훅을 세션 인자로 못 넘긴다. `hooks.json` 파일을 써야 하고, 게다가 비관리 훅은
 *   해시 기준 신뢰가 필요해 매 세션 달라지는 우리 명령은 매번 막힌다
 *   → `--dangerously-bypass-hook-trust` 를 붙인다.
 * - 에이전트 정의를 인라인으로 넘기는 `--agents` 가 없다. 지침은 프롬프트 앞에 붙인다.
 */

/** 승인을 물을 도구. matcher 는 정규식이고 canonical 이름에 걸린다. */
const GATED_TOOLS = '^(Bash|apply_patch|Edit|Write)$'

export class CodexCliAdapter {
  private child?: ChildProcessByStdio<Writable, Readable, Readable>
  private stdoutBuf = ''
  private stderrBuf = ''
  private settled = false
  /** item.started 로 먼저 알린 것을 item.completed 에서 다시 내보내지 않기 위해 */
  private startedItems = new Set<string>()
  private cwd = ''
  private model?: string

  constructor(private readonly emit: (e: SessionEvent) => void) {}

  start(opts: StartOptions): void {
    this.cwd = opts.cwd
    this.model = opts.model
    const cliArgs = buildCodexArgs(opts)
    const prompt = buildCodexPrompt(opts)

    const { command, args, windowsVerbatimArguments } = buildRunnerCommand(opts.runner, opts.cwd, cliArgs)
    this.emit({ t: 'status', status: 'starting' })

    try {
      this.child = spawn(command, args, {
        cwd: opts.runner.kind === 'wsl' ? undefined : opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments,
        // TLS 검사 프록시 뒤에서는 rustls 가 시스템 CA 만 본다.
        // 러너 홈에 CA 를 등록해 두지 않은 환경을 위해 번들 경로를 넘길 수 있게 한다.
        env: opts.caBundle ? { ...process.env, SSL_CERT_FILE: opts.caBundle } : process.env,
      })
    } catch (err) {
      this.settle('failed', `실행 실패: ${(err as Error).message} (${command})`)
      return
    }

    // 긴 Markdown을 Windows→WSL 명령행 인자로 넘기면 백틱 같은 문자가 중간
    // 파서에서 손실될 수 있다. Codex가 지원하는 stdin 프롬프트 경로를 사용한다.
    this.child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      // CLI가 시작 직후 종료되면 pipe가 먼저 닫힐 수 있다. 실제 종료 사유는
      // stderr/exit 처리에서 더 정확히 분류하므로 EPIPE는 그쪽에 맡긴다.
      if (error.code !== 'EPIPE') this.settle('failed', error.message)
    })
    this.child.stdin.end(prompt)

    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrBuf += chunk
    })

    this.child.on('error', (err) => this.settle('failed', err.message))

    // ★ Codex 는 전부 실패해도 종료코드 0 이다(실측). 코드로 판정하면 안 된다.
    //   turn.completed / turn.failed 를 못 본 채 끝났을 때만 실패로 본다.
    this.child.on('exit', () => {
      const reason = this.cleanStderr(this.stderrBuf)
      if (this.looksLikeAuthError(reason)) this.settle('auth-required', reason)
      else this.settle('failed', reason || '응답 없이 종료되었습니다')
    })
  }

  stop(): void {
    this.child?.kill()
    this.settle('stopped')
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk
    const lines = this.stdoutBuf.split('\n')
    this.stdoutBuf = lines.pop() ?? ''
    for (const line of lines) {
      const text = line.trim()
      // Codex 는 stdout 에 로그 줄도 섞어 보낸다(2026-…Z ERROR …). JSON 만 취한다.
      if (!text.startsWith('{')) continue
      try {
        this.handle(JSON.parse(text) as CodexEvent)
      } catch {
        // 깨진 줄은 버린다
      }
    }
  }

  private handle(e: CodexEvent): void {
    switch (e.type) {
      case 'thread.started':
        if (e.thread_id) {
          // Codex 는 세션 메타를 따로 주지 않는다. 아는 것만 채우고 나머지는 비운다 —
          // 추측해서 넣으면 화면이 사실이 아닌 값을 보여주게 된다.
          this.emit({
            t: 'session-meta',
            meta: {
              cliSessionId: e.thread_id,
              cwd: this.cwd,
              model: this.model ?? '',
              permissionMode: 'workspace-write',
              cliVersion: '',
              apiKeySource: '',
              tools: [],
            },
          })
        }
        this.emit({ t: 'status', status: 'running' })
        return

      case 'turn.completed': {
        const u = e.usage
        if (u) {
          // Codex 는 비용을 주지 않는다. 토큰만 싣고 비용은 0 으로 둔다.
          this.emit({
            t: 'usage',
            usage: {
              inputTokens: u.input_tokens ?? 0,
              outputTokens: u.output_tokens ?? 0,
              cacheReadTokens: u.cached_input_tokens ?? 0,
              cacheCreationTokens: u.cache_write_input_tokens ?? 0,
              // Codex 는 비용을 주지 않는다. 추측값을 넣지 않고 0 으로 둔다.
              totalCostUsd: 0,
            },
          })
        }
        this.settle('completed')
        return
      }

      case 'turn.failed':
        this.settle('failed', e.error?.message ?? '턴이 실패했습니다')
        return

      case 'error':
        // 재연결 시도 같은 중간 오류는 세션을 죽이지 않는다. 본문에만 남긴다.
        this.emit({
          t: 'message',
          role: 'assistant',
          messageId: `err-${Date.now()}`,
          text: e.message ?? '',
          isError: true,
        })
        return

      case 'item.started':
      case 'item.completed':
        this.handleItem(e.type, e.item)
        return

      default:
        return
    }
  }

  private handleItem(kind: 'item.started' | 'item.completed', item?: CodexItem): void {
    if (!item) return

    if (item.type === 'agent_message') {
      if (kind === 'item.completed' && item.text) {
        this.emit({ t: 'message', role: 'assistant', messageId: item.id, text: item.text })
      }
      return
    }

    if (item.type === 'error') {
      // 훅 신뢰 우회 경고는 우리가 매 세션 일부러 켜는 것이라 대화에 띄우지 않는다.
      // 사용자가 못 고치는 것을 오류로 보여주면 진짜 오류가 묻힌다.
      if (item.message?.includes('bypass-hook-trust')) return
      this.emit({
        t: 'message',
        role: 'assistant',
        messageId: item.id,
        text: item.message ?? '',
        isError: true,
      })
      return
    }

    // 도구 계열 — started 로 칩을 만들고 completed 로 결과를 채운다
    const name = TOOL_LABEL[item.type] ?? item.type
    if (kind === 'item.started') {
      this.startedItems.add(item.id)
      this.emit({ t: 'tool-use', toolUseId: item.id, name, input: toolInput(item) })
      return
    }

    if (!this.startedItems.has(item.id)) {
      // started 없이 completed 만 온 경우에도 흐름이 보이게 한다
      this.emit({ t: 'tool-use', toolUseId: item.id, name, input: toolInput(item) })
    }
    this.startedItems.delete(item.id)

    // status 는 실행이 끝났는지만 말한다. 명령 성공 여부는 exit_code 로 본다.
    const ok = item.status !== 'failed' && (item.exit_code == null || item.exit_code === 0)
    this.emit({
      t: 'tool-result',
      toolUseId: item.id,
      ok,
      preview: (item.aggregated_output ?? '').slice(0, 2000),
    })

    if (item.type === 'file_change') {
      for (const c of item.changes ?? []) {
        if (c.path) this.emit({ t: 'file-changed', path: c.path })
      }
    }
  }

  private settle(status: SessionStatus, reason?: string): void {
    if (this.settled) return
    this.settled = true
    this.emit({ t: 'status', status, reason })
  }

  private cleanStderr(text: string): string {
    return text
      .split('\n')
      .filter((l) => l.trim() && !/^\d{4}-\d{2}-\d{2}T/.test(l.trim()))
      .join('\n')
      .trim()
      .slice(0, 500)
  }

  private looksLikeAuthError(text: string): boolean {
    return /not logged in|unauthorized|401|codex login|missing bearer/i.test(text)
  }
}

export function buildCodexArgs(
  opts: Pick<StartOptions, 'agentPrompt' | 'systemPrompt' | 'hookCommand' | 'model' | 'prompt' | 'resumeSessionId'>,
): string[] {
  const cliArgs = ['exec', '--json', '--skip-git-repo-check']

  if (opts.model) cliArgs.push('--model', opts.model)
  // 파일을 고쳐야 하므로 workspace-write. 실제 통제는 승인 훅이 한다.
  cliArgs.push('--sandbox', 'workspace-write')

  if (opts.hookCommand) {
    // 훅은 `-c` 인라인 TOML 로 주입한다 — 세션 단위라 사용자 설정 파일을 건드리지 않는다.
    // (`hooks_file` 같은 키는 없다. hooks.json 을 쓰면 프로젝트에 파일이 남는다.)
    cliArgs.push('-c', `hooks.PreToolUse=${inlineHook(GATED_TOOLS, opts.hookCommand)}`)
    // 비관리 훅은 사람이 /hooks 에서 신뢰해야 도는데, 우리 명령은 세션마다
    // 승인 디렉터리가 달라 해시가 매번 바뀐다. 자동화에서는 우회가 유일한 길이다.
    cliArgs.push('--dangerously-bypass-hook-trust')
  }

  // 에이전트 지침은 프롬프트 앞에 붙인다 (--agents 상당 기능이 없다)
  // `resume` 뒤에는 resume 전용 옵션만 둔다. 공통 exec 옵션은 반드시 앞에 와야 한다.
  if (opts.resumeSessionId) cliArgs.push('resume', opts.resumeSessionId)
  cliArgs.push('-')
  return cliArgs
}

/** 명령행 이스케이프를 거치지 않고 stdin으로 보낼 전체 프롬프트. */
export function buildCodexPrompt(
  opts: Pick<StartOptions, 'agentPrompt' | 'systemPrompt' | 'prompt'>,
): string {
  const prefixes = [opts.agentPrompt, opts.systemPrompt].filter(Boolean)
  return prefixes.length ? `${prefixes.join('\n\n')}\n\n---\n\n${opts.prompt}` : opts.prompt
}

/**
 * `-c` 값은 TOML 로 파싱된다. 인라인 테이블 배열로 넘긴다.
 * 실측: `-c "hooks.SessionStart=[{hooks=[{type=\"command\", command=\"…\"}]}]"` 로 훅이 돈다.
 */
function inlineHook(matcher: string, command: string): string {
  const esc = (v: string): string => JSON.stringify(v) // TOML 기본 문자열은 JSON 과 이스케이프가 같다
  return `[{matcher=${esc(matcher)}, hooks=[{type="command", command=${esc(command)}, timeout=300}]}]`
}

const TOOL_LABEL: Record<string, string> = {
  command_execution: 'Bash',
  file_change: 'Edit',
  mcp_tool_call: 'MCP',
  web_search: 'WebSearch',
  reasoning: 'Reasoning',
  todo_list: 'Plan',
}

function toolInput(item: CodexItem): unknown {
  if (item.command) return { command: item.command }
  if (item.changes) return { file_path: item.changes.map((c) => c.path).join(', ') }
  if (item.query) return { query: item.query }
  return {}
}

interface CodexEvent {
  type: string
  thread_id?: string
  message?: string
  error?: { message?: string }
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cached_input_tokens?: number
    cache_write_input_tokens?: number
    reasoning_output_tokens?: number
  }
  item?: CodexItem
}

interface CodexItem {
  id: string
  type: string
  text?: string
  message?: string
  command?: string
  query?: string
  status?: string
  /** command_execution 결과 (stdout+stderr 합본) */
  aggregated_output?: string
  exit_code?: number | null
  changes?: { path?: string; kind?: string }[]
}
