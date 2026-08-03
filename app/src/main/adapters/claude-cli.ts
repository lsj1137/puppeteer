import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { DetectedRunner, SessionEvent } from '@shared/session'

export interface StartOptions {
  runner: DetectedRunner
  /** 작업 디렉토리 (Windows 경로 그대로 전달 가능) */
  cwd: string
  prompt: string
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
 */
const GATED_TOOLS = 'Bash|PowerShell|Write|Edit|NotebookEdit'

/**
 * Claude Code CLI 를 stream-json 으로 구동하는 어댑터.
 * 이벤트 형태는 CLI 2.1.220 실측 기준 (spike/REPORT.md).
 */
export class ClaudeCliAdapter {
  private child?: ChildProcessByStdio<null, Readable, Readable>
  private stdoutBuf = ''
  private stderrBuf = ''
  /** message.id 별로 이미 내보낸 텍스트 — 중복 방출 방지 */
  private emittedText = new Set<string>()
  /** 종료 상태를 이미 냈는지. result 와 exit 가 겹쳐 덮어쓰는 것을 막는다 */
  private settled = false

  constructor(private readonly emit: (e: SessionEvent) => void) {}

  start(opts: StartOptions): void {
    const cliArgs = buildClaudeArgs(opts)
    const { command, args } = this.buildCommand(opts, cliArgs)

    this.emit({ t: 'status', status: 'starting' })

    // stdin 은 반드시 닫는다. 열어두면 CLI 가 3초 대기 후 경고를 낸다.
    // spawn 은 동기 throw 를 낼 수 있다(예: .cmd 직접 실행 시 EINVAL).
    // 그대로 두면 IPC 가 거부되고 화면에 아무것도 뜨지 않으므로 반드시 이벤트로 바꾼다.
    try {
      this.child = spawn(command, args, {
        cwd: opts.runner.kind === 'wsl' ? undefined : opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (err) {
      this.settle('failed', `실행 실패: ${(err as Error).message} (${command})`)
      return
    }

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
      const reason = this.cleanStderr(this.stderrBuf) || `exit code ${code}`
      // 인증 실패는 stdout 이 없는 채로 정상 종료코드로 끝나기도 하므로 code 와 무관하게 검사한다
      if (this.looksLikeAuthError(reason)) {
        this.settle('auth-required', reason)
      } else if (code !== 0) {
        this.settle('failed', reason)
      }
    })
  }

  private settle(status: 'completed' | 'failed' | 'auth-required' | 'stopped', reason?: string): void {
    if (this.settled) return
    this.settled = true
    this.emit({ t: 'status', status, reason })
  }

  stop(): void {
    this.child?.kill()
    this.settle('stopped')
  }

  private buildCommand(
    opts: StartOptions,
    cliArgs: string[],
  ): { command: string; args: string[] } {
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
            },
          })
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
        const toolUseId: string =
          (ev.message?.content ?? []).find((b: any) => b.type === 'tool_result')?.tool_use_id ?? ''
        this.handleToolResult(toolUseId, ev.tool_use_result)
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
            totalCostUsd: ev.total_cost_usd ?? 0,
          },
        })
        // 인증 실패는 stderr 가 아니라 stdout(result.result)로 온다
        const resultText = typeof ev.result === 'string' ? ev.result : ''
        if (ev.is_error && this.looksLikeAuthError(resultText)) {
          this.settle('auth-required', resultText)
        } else {
          this.settle(
            ev.is_error ? 'failed' : 'completed',
            resultText || ev.terminal_reason,
          )
        }
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
  private handleToolResult(toolUseId: string, r: any): void {
    if (!r || typeof r !== 'object') return

    const emitPreview = (ok: boolean, text: string): void => {
      this.emit({ t: 'tool-result', toolUseId, ok, preview: this.clip(text) })
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
      emitPreview(!err, combined || '(출력 없음)')
      return
    }

    // Read 등 나머지는 Artifact 로 만들지 않는다
    emitPreview(true, '')
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
export function buildRunnerCommand(
  runner: DetectedRunner,
  cwd: string,
  cliArgs: string[],
  hostPlatform = process.platform,
): { command: string; args: string[] } {
  const opts = { runner, cwd }
  const args = [...(runner.executableArgs ?? []), ...cliArgs]
  if (opts.runner.kind === 'wsl') {
    // 반드시 탐지된 절대경로로 실행한다.
    // WSL 은 interop 으로 Windows PATH 를 뒤에 붙이므로, 바 `claude` 로 실행하면
    // Windows 에 설치된 확장자 없는 npm 래퍼가 잡혀 다른 자격증명을 쓰게 된다.
    // wsl --cd 는 Windows 경로를 받아 알아서 변환해준다.
    return {
      command: 'wsl.exe',
      args: [
        '-d',
        opts.runner.distro ?? 'Ubuntu',
        '--cd',
        opts.cwd,
        '--',
        opts.runner.executable,
        ...args,
      ],
    }
  }
  // Windows: .cmd / .bat 는 직접 spawn 할 수 없다 (Node 보안 수정 이후 EINVAL).
  // shell:true 는 인용 처리가 위험하므로 cmd.exe /c 로 감싸고 인자는 배열로 넘긴다.
  const exe = opts.runner.executable
  if (hostPlatform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    return { command: 'cmd.exe', args: ['/c', exe, ...args] }
  }

  return { command: exe, args }
}

export function buildClaudeArgs(
  opts: Pick<
    StartOptions,
    | 'agentName'
    | 'agentsJson'
    | 'allowedTools'
    | 'disallowedTools'
    | 'hookCommand'
    | 'prompt'
    | 'resumeSessionId'
  >,
): string[] {
  const cliArgs = [
    '-p',
    opts.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
  ]
  if (opts.resumeSessionId) cliArgs.push('--resume', opts.resumeSessionId)

  // 에이전트는 앱 라이브러리에서 관리하므로 정의를 인라인으로 넘긴다.
  // 파일을 러너 홈(.claude/agents)에 배치할 필요가 없다 — WSL/Windows 홈이 다르다.
  if (opts.agentsJson) cliArgs.push('--agents', opts.agentsJson)
  if (opts.agentName) cliArgs.push('--agent', opts.agentName)
  if (opts.allowedTools?.length) cliArgs.push('--allowedTools', opts.allowedTools.join(' '))
  if (opts.disallowedTools?.length)
    cliArgs.push('--disallowedTools', opts.disallowedTools.join(' '))

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
