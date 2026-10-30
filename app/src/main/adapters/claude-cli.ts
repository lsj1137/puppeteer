import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import type { ApprovalMode, DetectedRunner, RateLimitWindow, SessionEvent } from '@shared/session'
import { isSlashCommand } from '@shared/slash-command'
import { isOllama, resolveModel as resolveOllamaModel, runnerEnv } from '../ollama'

export interface StartOptions {
  runner: DetectedRunner
  /** 작업 디렉토리 (Windows 경로 그대로 전달 가능) */
  cwd: string
  prompt: string
  /** 앱 기능 계약처럼 매 턴에만 붙이는 시스템 지침. 사용자 설정 파일은 건드리지 않는다. */
  systemPrompt?: string
  /** 기존 CLI 세션 이어가기 */
  resumeSessionId?: string
  /** PreToolUse hook 실행 명령. 지정하면 승인 인터셉트가 켜진다. */
  hookCommand?: string
  /** 메인 세션에 적용할 에이전트 이름 */
  agentName?: string
  /** `--agents` 로 넘길 정의 JSON. 주면 파일이 어디 있든 상관없이 그 정의가 쓰인다. */
  agentsJson?: string
  /** 도구 제한 */
  allowedTools?: string[]
  disallowedTools?: string[]
  /**
   * 이 세션의 승인 모드. `auto` 면 CLI 자체 권한 검사도 푼다 — 승인 훅은 일부 도구에만 걸려서,
   * 훅 밖(작업 폴더 밖 Read 등)은 «자동 승인» 인데도 CLI 가 묻지 못하고 거부했다.
   * 세션마다 실행 인자로만 붙고 사용자 설정 파일은 건드리지 않는다. 보조 run 은 넘기지 않는다.
   */
  approvalMode?: ApprovalMode
  /** 작업 폴더 밖이지만 접근을 허용할 폴더(러너 경로). `--add-dir` 로 넘긴다. */
  addDirs?: string[]

  // ── 아래는 Codex 어댑터가 쓴다 (Claude 는 무시) ──
  /** 에이전트 지침 본문. --agents 가 없는 CLI 는 프롬프트 앞에 붙인다. */
  agentPrompt?: string
  /** 모델 슬러그 */
  model?: string
  /** 승인 디렉터리(호스트 경로). 훅 정의 파일을 여기 쓴다. */
  approvalDirHost?: string
  /** 러너가 볼 수 있는 훅 정의 파일 경로 */
  hooksFileRunnerPath?: string
  /** 검사 프록시의 CA 번들. rustls 계열이 시스템 저장소만 볼 때 넘긴다. */
  caBundle?: string
}

/**
 * 승인을 물을 도구.
 * 읽기 계열(Read/Glob/Grep)은 hook 을 거치지 않게 해서 승인 요청 자체를 줄인다.
 *
 * WebFetch·WebSearch 도 권한이 필요한 도구다. `-p` 모드는 사람에게 물을 수 없어서 hook 이
 * 없으면 CLI 가 곧바로 거부한다 — 세션이 자동 승인이어도 그 설정이 닿지 않는다. 실제로 웹 조사
 * 위임 6건이 전부 «haven't granted it yet» 으로 한 페이지도 못 열고 끝났다.
 */
const GATED_TOOLS = 'Bash|PowerShell|Write|Edit|NotebookEdit|WebFetch|WebSearch'

/** `result` 뒤 이 시간 안에 프로세스가 안 끝나면 백그라운드 작업을 기다리는 것으로 본다. */
const BACKGROUND_GRACE_MS = 3_000

/**
 * Claude Code CLI 를 stream-json 으로 구동하는 어댑터.
 * 이벤트 형태는 CLI 2.1.220 실측 기준 (spike/REPORT.md).
 */
export class ClaudeCliAdapter {
  private child?: ChildProcessByStdio<Writable, Readable, Readable>
  private stdoutBuf = ''
  private stderrBuf = ''
  /** message.id 별로 이미 내보낸 텍스트 — 중복 방출 방지 */
  private emittedText = new Set<string>()
  /** 종료 상태를 이미 냈는지. result 와 exit 가 겹쳐 덮어쓰는 것을 막는다 */
  private settled = false
  private runner?: DetectedRunner
  /**
   * 마지막 턴의 결과. **`result` 는 «턴 끝» 이지 «프로세스 끝» 이 아니다.** 요즘 CLI 는 한 프로세스
   * 안에서 턴을 여러 번 돈다 — 백그라운드로 돌린 작업이 끝나면 그 알림으로 스스로 다음 턴을
   * 시작한다(2026-10 실측). 예전처럼 첫 `result` 에서 완료로 처리하면 앱이 실행 중 목록에서
   * 빼 버려, 다음 지시가 예약되지 않고 새 프로세스로 겹쳐 돌고(중복 작업), 승인 감시가 풀려
   * 이어지는 Bash 가 시간 초과로 막히고, worktree 자동 커밋이 작업 도중에 돌았다.
   * 그래서 결과는 기억만 해 두고, 완료는 프로세스가 끝날 때 마지막 결과로 판정한다.
   */
  private lastResult?: { isError: boolean; text?: string }
  private backgroundTimer?: ReturnType<typeof setTimeout>

  constructor(private readonly emit: (e: SessionEvent) => void) {}

  start(opts: StartOptions): void {
    if (!isOllama(opts.runner)) return this.launch(opts)
    // Ollama 는 받아 둔 모델 이름으로만 답한다. «CLI 기본»·`opus` 같은 값은 실제 모델로 바꿔 띄운다.
    this.emit({ t: 'status', status: 'starting' })
    void resolveOllamaModel(opts.model).then(
      (model) => {
        // 모델을 고르는 사이 멈춤을 눌렀으면 띄우지 않는다.
        if (!this.settled) this.launch({ ...opts, model })
      },
      (err: Error) => this.settle('failed', err.message),
    )
  }

  private launch(opts: StartOptions): void {
    this.runner = opts.runner
    const cliArgs = buildClaudeArgs(opts)
    const prompt = buildClaudePrompt(opts)
    const { command, args, windowsVerbatimArguments } = this.buildCommand(opts, cliArgs)

    this.emit({ t: 'status', status: 'starting' })

    // 긴 사용자·시스템 지침을 Windows→WSL 명령행에 싣지 않는다. 명령행 한도를 넘으면
    // wsl.exe가 시작되기도 전에 spawn ENAMETOOLONG이 발생하므로 stdin으로 전달한다.
    // spawn 은 동기 throw 를 낼 수 있다(예: .cmd 직접 실행 시 EINVAL).
    // 그대로 두면 IPC 가 거부되고 화면에 아무것도 뜨지 않으므로 반드시 이벤트로 바꾼다.
    try {
      this.child = spawn(command, args, {
        cwd: opts.runner.kind === 'wsl' ? undefined : opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments,
        env: runnerEnv(opts.runner, opts.model),
      })
    } catch (err) {
      this.settle('failed', `실행 실패: ${(err as Error).message} (${command})`)
      return
    }

    this.child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') this.settle('failed', error.message)
    })
    this.child.stdin.end(prompt)

    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk))

    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrBuf += chunk
    })

    this.child.on('error', (err) => {
      this.settle('failed', err.message)
    })

    this.child.on('exit', (code) => {
      clearTimeout(this.backgroundTimer)
      const reason = this.cleanStderr(this.stderrBuf) || `exit code ${code}`
      // 인증 실패는 stdout 이 없는 채로 정상 종료코드로 끝나기도 하므로 code 와 무관하게 검사한다
      if (this.looksLikeAuthError(reason)) {
        this.settle('auth-required', reason)
      } else if (code !== 0) {
        this.settle('failed', reason)
      } else {
        // 프로세스가 끝난 지금이 진짜 완료다. 마지막 턴의 결과로 판정한다.
        const last = this.lastResult
        this.settle(last?.isError ? 'failed' : 'completed', last?.text)
      }
    })
  }

  private settle(status: 'completed' | 'failed' | 'auth-required' | 'stopped', reason?: string): void {
    if (this.settled) return
    this.settled = true
    this.emit({ t: 'status', status, reason })
  }

  stop(): void {
    clearTimeout(this.backgroundTimer)
    this.child?.kill()
    this.settle('stopped')
  }

  private buildCommand(
    opts: StartOptions,
    cliArgs: string[],
  ): RunnerCommand {
    return buildRunnerCommand(opts.runner, opts.cwd, cliArgs)
  }

  /** wsl.exe 가 매 호출마다 뱉는 잡음을 걸러낸다 (드라이브 마운트 경고 등) */
  private cleanStderr(text: string): string {
    return text
      .split('\n')
      .filter((l) => !/^wsl:\s/i.test(l.trim()))
      .join('\n')
      .trim()
  }

  private looksLikeAuthError(text: string): boolean {
    return /log ?in|sign ?in|unauthor|authenticat|oauth|api[ _-]?key|credential|token .*(expired|refresh)/i.test(
      text,
    )
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk
    const lines = this.stdoutBuf.split('\n')
    this.stdoutBuf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        this.translate(JSON.parse(line))
      } catch {
        // 부분 수신/비 JSON 라인은 무시
      }
    }
  }

  /** CLI 원시 이벤트 → 정규화된 SessionEvent */
  private translate(ev: any): void {
    switch (ev.type) {
      case 'system': {
        if (ev.subtype === 'init') {
          this.emit({
            t: 'session-meta',
            meta: {
              cliSessionId: ev.session_id,
              cwd: ev.cwd,
              model: ev.model,
              permissionMode: ev.permissionMode,
              cliVersion: ev.claude_code_version,
              apiKeySource: ev.apiKeySource,
              tools: ev.tools ?? [],
              memoryPaths: ev.memory_paths,
              slashCommands: Array.isArray(ev.slash_commands) ? ev.slash_commands : undefined,
            },
          })
          // 같은 프로세스가 다음 턴을 시작했다(백그라운드 작업 알림 등). 다시 실행 중이다.
          clearTimeout(this.backgroundTimer)
          this.emit({ t: 'status', status: 'running' })
        }
        return
      }

      case 'rate_limit_event': {
        const info = ev.rate_limit_info ?? {}
        this.emit({
          t: 'rate-limit',
          info: {
            status: info.status,
            rateLimitType: info.rateLimitType,
            resetsAt: info.resetsAt,
            fiveHour: rateWindow(info.unifiedWindows?.five_hour),
            sevenDay: rateWindow(info.unifiedWindows?.seven_day),
            receivedAt: Date.now(),
          },
        })
        return
      }

      case 'assistant': {
        const msg = ev.message ?? {}
        // CLI 는 API 오류도 assistant 메시지로 흘려보낸다. 본문과 섞이지 않게 표시를 남긴다.
        const isError = ev.is_api_error_message === true || Boolean(ev.error)
        for (const block of msg.content ?? []) {
          if (block.type === 'text') {
            // 같은 message.id 로 블록이 나뉘어 오므로 텍스트 단위로 중복 제거
            const key = `${msg.id}:${block.text}`
            if (this.emittedText.has(key)) continue
            this.emittedText.add(key)
            this.emit({
              t: 'message',
              role: 'assistant',
              messageId: msg.id,
              text: block.text,
              isError,
            })
          } else if (block.type === 'tool_use') {
            this.emit({
              t: 'tool-use',
              toolUseId: block.id,
              name: block.name,
              input: block.input,
            })
            const path = this.extractPath(block)
            if (path) this.emit({ t: 'file-changed', path })
          }
        }
        return
      }

      case 'user': {
        const block = (ev.message?.content ?? []).find((b: any) => b.type === 'tool_result')
        const toolUseId: string = block?.tool_use_id ?? ''
        this.handleToolResult(toolUseId, ev.tool_use_result, block?.is_error === true, toolResultText(block))
        return
      }

      case 'result': {
        const u = ev.usage ?? {}
        this.emit({
          t: 'usage',
          usage: {
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
            cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
            totalCostUsd: costUsd(ev.total_cost_usd, this.runner),
            costCumulative: isCumulativeCost(u, ev.modelUsage),
          },
        })
        // 인증 실패는 stderr 가 아니라 stdout(result.result)로 온다
        const resultText = typeof ev.result === 'string' ? ev.result : ''
        if (ev.is_error && this.looksLikeAuthError(resultText)) {
          this.settle('auth-required', resultText)
          return
        }
        this.lastResult = { isError: !!ev.is_error, text: resultText || ev.terminal_reason }
        // 보통은 곧바로 프로세스가 끝난다. 잠시 뒤에도 살아 있으면 백그라운드 작업을 기다리는 것이다.
        clearTimeout(this.backgroundTimer)
        this.backgroundTimer = setTimeout(() => {
          if (!this.settled) this.emit({ t: 'status', status: 'background' })
        }, BACKGROUND_GRACE_MS)
        return
      }
    }
  }

  /**
   * 도구 실행 결과 처리.
   *
   * Artifact 는 "나중에 다시 볼 가치가 있는 산출물"만 담는다.
   * 모든 stdout 을 넣으면 `echo` 결과까지 쌓여 패널이 쓸모없어진다.
   *
   * | 도구 | Artifact |
   * |---|---|
   * | Write  | 생성=code, 수정=diff |
   * | Edit   | diff |
   * | Bash   | 길거나(>8줄) stderr 있을 때만 log |
   * | Read / Glob / Grep | 없음 (입력·탐색이지 산출물이 아님) |
   */
  /**
   * 성공/실패는 **`tool_result.is_error`** 로만 판정한다.
   *
   * 예전에는 stderr 가 있으면 실패로 칠했다. 그런데 CLI 는 작업 폴더 밖으로 `cd` 하면
   * «Shell cwd was reset to …» 를 stderr 로 붙이고, git·npm 도 정상 종료하며 stderr 에 쓴다.
   * 실제 기록 열흘치 Bash 1,772건 중 927건이 멀쩡한 결과인데 «실패» 로 찍혔다.
   * 반대로 진짜 실패(종료 코드 ≠ 0)는 `tool_use_result` 가 객체가 아니라 «Error: Exit code N …»
   * **문자열** 로 와서 아무것도 표시하지 않았다(실측 2026-10-30, CLI 2.1.284).
   */
  private handleToolResult(toolUseId: string, r: any, isError = false, blockText = ''): void {
    const emitPreview = (ok: boolean, text: string): void => {
      this.emit({ t: 'tool-result', toolUseId, ok, preview: this.clip(text) })
    }

    if (!r || typeof r !== 'object') {
      if (!toolUseId) return
      emitPreview(!isError, typeof r === 'string' && r ? r : blockText)
      return
    }

    // 파일 생성/수정
    if (typeof r.filePath === 'string') {
      const patch = Array.isArray(r.structuredPatch) ? r.structuredPatch : []
      if (patch.length > 0) {
        this.emit({
          t: 'artifact',
          kind: 'diff',
          path: r.filePath,
          language: 'diff',
          content: toUnifiedDiff(r.filePath, patch),
        })
        emitPreview(true, `${r.filePath} 수정됨`)
      } else if (typeof r.content === 'string') {
        this.emit({
          t: 'artifact',
          kind: 'code',
          path: r.filePath,
          language: guessLang(r.filePath),
          content: r.content,
        })
        emitPreview(true, `${r.filePath} 생성됨`)
      }
      return
    }

    // 셸 실행
    if (typeof r.stdout === 'string' || typeof r.stderr === 'string') {
      const out = String(r.stdout ?? '')
      const err = String(r.stderr ?? '')
      const combined = [out, err].filter(Boolean).join('\n')
      const long = combined.split('\n').length > 8 || combined.length > 400

      if (long || err) {
        this.emit({ t: 'artifact', kind: 'log', content: combined })
      }
      emitPreview(!isError, combined || '(출력 없음)')
      return
    }

    // Read 등 나머지는 Artifact 로 만들지 않는다
    emitPreview(!isError, isError ? blockText : '')
  }

  /** 대화에 인라인으로 붙일 짧은 미리보기 */
  private clip(text: string, lines = 6, chars = 400): string {
    const t = text.trim()
    if (!t) return ''
    const head = t.split('\n').slice(0, lines).join('\n')
    return head.length > chars ? `${head.slice(0, chars)}…` : head
  }

  /** Write/Edit 계열 도구 입력에서 대상 파일 경로를 뽑는다 (동시 수정 감지용) */
  private extractPath(block: any): string | undefined {
    if (!/^(Write|Edit|NotebookEdit)$/.test(block.name)) return undefined
    const p = block.input?.file_path ?? block.input?.notebook_path
    return typeof p === 'string' ? p : undefined
  }
}

/** tool_result 블록 본문. 문자열이거나 `{type:'text', text}` 배열이다. */
export function toolResultText(block: any): string {
  const content = block?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** structuredPatch → 통합 diff 텍스트 */
function toUnifiedDiff(path: string, patch: any[]): string {
  const out = [`--- a/${path}`, `+++ b/${path}`]
  for (const h of patch) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)
    for (const l of h.lines ?? []) out.push(String(l))
  }
  return out.join('\n')
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', json: 'json',
  py: 'python', java: 'java', sql: 'sql', sh: 'bash', yml: 'yaml', yaml: 'yaml',
  md: 'markdown', html: 'html', css: 'css', xml: 'xml',
}

function guessLang(path: string): string | undefined {
  return EXT_LANG[path.split('.').pop()?.toLowerCase() ?? '']
}

/**
 * Runner 종류에 따라 실제 실행 명령을 구성한다.
 * 세션 어댑터와 라우터가 함께 쓴다 — 러너별 함정이 한 곳에만 있어야 한다.
 */
/**
 * CLI 가 알려준 비용. Ollama 로 돌면 0 이다.
 * CLI 는 모르는 모델에도 자기 단가표로 값을 지어 낸다(실측 `costBasis: unknown`, 한 턴 $0.0108).
 * 그대로 두면 로컬 모델 사용량에 없는 비용이 쌓인다.
 */
export function rateWindow(raw: any): RateLimitWindow | undefined {
  if (typeof raw?.utilization !== 'number' || typeof raw?.resetsAt !== 'number') return undefined
  return { utilization: raw.utilization, resetsAt: raw.resetsAt }
}

/** 결과의 `modelUsage`(대화 누적) 토큰 합이 `usage`(이번 턴) 보다 크면 비용도 누적값이다. */
export function isCumulativeCost(usage: any, modelUsage: any): boolean | undefined {
  if (!modelUsage || typeof modelUsage !== 'object') return undefined
  const turn = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
  const total = Object.values(modelUsage as Record<string, any>).reduce(
    (sum: number, m: any) => sum + (m?.inputTokens ?? 0) + (m?.outputTokens ?? 0),
    0,
  )
  // 첫 턴은 둘이 같아 구분이 안 된다. 누적이든 턴별이든 그 턴 값이 곧 증가분이라 상관없다.
  return total > turn ? true : undefined
}

export function costUsd(reported: number | undefined, runner: DetectedRunner | undefined): number {
  return runner && isOllama(runner) ? 0 : (reported ?? 0)
}

export function buildRunnerCommand(
  runner: DetectedRunner,
  cwd: string,
  cliArgs: string[],
  hostPlatform = process.platform,
): RunnerCommand {
  const opts = { runner, cwd }
  const args = [...(runner.executableArgs ?? []), ...cliArgs]
  if (opts.runner.kind === 'wsl') {
    // 반드시 탐지된 절대경로로 실행한다.
    // WSL 은 interop 으로 Windows PATH 를 뒤에 붙이므로, 바 `claude` 로 실행하면
    // Windows 에 설치된 확장자 없는 npm 래퍼가 잡혀 다른 자격증명을 쓰게 된다.
    // wsl --cd 는 Windows 경로를 받아 알아서 변환해준다.
    //
    // **`--` 가 아니라 `-e` 다.** `--` 는 wsl 자신의 옵션 파싱만 끝낼 뿐, 명령은
    // 그대로 **기본 로그인 셸에 실린다**. 그러면 인자 안의 백틱과 `$( )` 가 셸에서
    // 평가된다 — `--agents` 로 넘기는 Agent 지침은 마크다운이라 인라인 코드 백틱이
    // 흔하고, 그 안의 텍스트가 실제 명령으로 실행된다(임의 명령 실행).
    //
    // `-e` 로 셸을 끊되 로그인 환경은 그대로 둬야 해서 `bash -lc` 를 한 겹 세운다.
    // 스크립트는 **고정 문자열**이고 실행 파일과 인자는 `$0`·`$@` 로 받으므로
    // 내용이 다시 해석되지 않는다. 문자열을 조립해 넣으면 같은 구멍이 다시 난다.
    return {
      command: 'wsl.exe',
      args: [
        '-d',
        opts.runner.distro ?? 'Ubuntu',
        '--cd',
        opts.cwd,
        '-e',
        'bash',
        '-lc',
        'exec "$0" "$@"',
        opts.runner.executable,
        ...args,
      ],
    }
  }
  // Windows: .cmd / .bat 는 직접 spawn 할 수 없다 (Node 보안 수정 이후 EINVAL).
  // shell:true 는 인용 처리가 위험하므로 cmd.exe /c 로 감싸고 인자는 배열로 넘긴다.
  const exe = opts.runner.executable
  if (hostPlatform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    return buildWindowsCmdCommand(exe, args)
  }

  return { command: exe, args }
}

export interface RunnerCommand {
  command: string
  args: string[]
  windowsVerbatimArguments?: boolean
}

const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/**
 * cmd.exe와 Windows argv 파서를 모두 통과하도록 인자 하나를 인용한다.
 * npm .cmd shim이 한 번 더 파싱하므로 메타문자를 두 번 escape한다.
 */
export function escapeWindowsCmdArgument(value: string, doubleEscape = true): string {
  let arg = String(value)
  arg = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
  arg = arg.replace(/(?=(\\+?)?)\1$/g, '$1$1')
  arg = `"${arg}"`.replace(CMD_META, '^$1')
  return doubleEscape ? arg.replace(CMD_META, '^$1') : arg
}

export function buildWindowsCmdCommand(executable: string, args: string[]): RunnerCommand {
  const escapedExecutable = executable.replace(CMD_META, '^$1')
  const shellCommand = [escapedExecutable, ...args.map((arg) => escapeWindowsCmdArgument(arg))].join(
    ' ',
  )
  return {
    command: process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${shellCommand}"`],
    windowsVerbatimArguments: true,
  }
}

export function buildClaudeArgs(
  opts: Pick<
    StartOptions,
    | 'agentName'
    | 'agentsJson'
    | 'allowedTools'
    | 'disallowedTools'
    | 'approvalMode'
    | 'addDirs'
    | 'hookCommand'
    | 'model'
    | 'prompt'
    | 'resumeSessionId'
  >,
): string[] {
  const cliArgs = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
  ]
  if (opts.resumeSessionId) cliArgs.push('--resume', opts.resumeSessionId)
  // 예전에는 model 을 받고도 CLI 에 넘기지 않아, Agent 에 모델을 지정해도 조용히 무시됐다.
  if (opts.model) cliArgs.push('--model', opts.model)
  // 에이전트는 앱 라이브러리에서 관리하므로 정의를 인라인으로 넘긴다.
  // 파일을 러너 홈(.claude/agents)에 배치할 필요가 없다 — WSL/Windows 홈이 다르다.
  if (opts.agentsJson) cliArgs.push('--agents', opts.agentsJson)
  if (opts.agentName) cliArgs.push('--agent', opts.agentName)
  if (opts.allowedTools?.length) cliArgs.push('--allowedTools', opts.allowedTools.join(' '))
  if (opts.disallowedTools?.length)
    cliArgs.push('--disallowedTools', opts.disallowedTools.join(' '))
  if (opts.approvalMode === 'auto') cliArgs.push('--permission-mode', 'bypassPermissions')
  // `--add-dir` 는 여러 값을 받는 옵션이다. 뒤 인자를 삼키지 않게 폴더마다 따로 붙인다.
  for (const dir of opts.addDirs ?? []) cliArgs.push('--add-dir', dir)

  // 사용자의 settings.json 은 절대 건드리지 않는다. 세션 단위로만 주입한다.
  // (실제 환경에 다른 도구가 hook 을 등록해 둔 사례를 확인했다 — spike/REPORT.md)
  if (opts.hookCommand) {
    cliArgs.push(
      '--settings',
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: GATED_TOOLS,
              hooks: [{ type: 'command', command: opts.hookCommand, timeout: 300 }],
            },
          ],
        },
      }),
    )
  }

  return cliArgs
}

/**
 * Windows 명령행 한도와 무관하게 stdin으로 보낼 Claude 입력 전문.
 *
 * 슬래시 명령에는 앱 지침을 붙이지 않는다. CLI 는 입력이 `/` 로 시작할 때만 명령으로
 * 처리하므로, 지침을 앞에 붙이면 명령이 일반 메시지가 되어 모델로 넘어간다.
 * 그 턴에는 Memory 제안·위임 블록을 받지 못하는 대가가 있다.
 */
export function buildClaudePrompt(
  opts: Pick<StartOptions, 'prompt' | 'systemPrompt'>,
): string {
  if (isSlashCommand(opts.prompt)) return opts.prompt.trimStart()
  return opts.systemPrompt
    ? `${opts.systemPrompt}\n\n---\n\n${opts.prompt}`
    : opts.prompt
}
