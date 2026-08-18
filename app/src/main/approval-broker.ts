import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { ApprovalDecision, ApprovalRequest, RiskLevel } from '@shared/session'

const HOLD_REASON =
  '사용자 응답 대기 시간 초과. 이 작업은 보류되었습니다. 세션을 종료하지 말고, 다른 진행 가능한 작업을 하거나 사용자 지시를 기다리세요.'

interface Watched {
  dir: string
  sessionId: string
  /** 이 감시 대상이 속한 실행 단위. 보조 Agent 가 붙으면 세션 하나에 여러 개가 생긴다. */
  runId: string
  timer: NodeJS.Timeout
  /** Allow for Session 으로 통과시킬 도구 이름 */
  sessionAllowed: Set<string>
  autoApprove: boolean
  seen: Set<string>
}

/**
 * hook 이 남긴 승인 요청 파일을 감시하고, 사용자의 결정을 응답 파일로 되돌려준다.
 * WSL2 는 NAT 라 WSL→Windows localhost 가 통하지 않으므로 HTTP 대신 파일로 주고받는다.
 */
export class ApprovalBroker {
  /** 키는 run id 다. 보조 Agent 가 동시에 요청해도 서로 섞이지 않는다. */
  private watched = new Map<string, Watched>()
  /** 승인 ID → 응답 파일 경로 */
  private open = new Map<string, { dir: string; base: string; sessionId: string; runId: string }>()

  constructor(private readonly onRequest: (req: ApprovalRequest) => void) {}

  attach(runId: string, sessionId: string, dir: string, autoApprove = false): void {
    mkdirSync(dir, { recursive: true })

    // 같은 run 에 이어서 지시하면 attach 가 다시 불린다.
    // 그대로 두면 타이머가 하나 더 돌고, 세션 단위 허용이 매 턴 초기화된다.
    const prev = this.watched.get(runId)
    if (prev) {
      prev.dir = dir
      prev.autoApprove = autoApprove
      return
    }

    this.watched.set(runId, {
      dir,
      sessionId,
      runId,
      sessionAllowed: new Set(),
      autoApprove,
      seen: new Set(),
      timer: setInterval(() => this.poll(runId), 200),
    })
  }

  /** 승인 정책은 세션 단위다 — 그 세션의 모든 run 에 함께 적용한다. */
  setAutoApprove(sessionId: string, enabled: boolean): void {
    for (const watched of this.watched.values()) {
      if (watched.sessionId !== sessionId) continue
      watched.autoApprove = enabled
      if (!enabled) watched.sessionAllowed.clear()
    }
  }

  detach(runId: string): void {
    const w = this.watched.get(runId)
    if (!w) return
    clearInterval(w.timer)
    this.watched.delete(runId)
    for (const [id, entry] of this.open) {
      if (entry.runId === runId) this.open.delete(id)
    }
    try {
      rmSync(w.dir, { recursive: true, force: true })
    } catch {
      // 정리 실패는 무시
    }
  }

  /** 세션이 끝나면 그 세션의 보조 run 감시까지 모두 걷는다. */
  detachSession(sessionId: string): void {
    for (const runId of [...this.watched.keys()]) {
      if (this.watched.get(runId)?.sessionId === sessionId) this.detach(runId)
    }
  }

  /** 사용자의 결정을 hook 에 돌려준다 */
  resolve(approvalId: string, decision: ApprovalDecision, reason?: string): void {
    const entry = this.open.get(approvalId)
    if (!entry) return
    this.open.delete(approvalId)

    if (decision === 'allow-session') {
      const tool = approvalId.split('::')[1]
      // "이 세션에서 허용"이므로 같은 세션의 다른 run 에도 적용한다.
      if (tool) {
        for (const w of this.watched.values()) {
          if (w.sessionId === entry.sessionId) w.sessionAllowed.add(tool)
        }
      }
    }

    this.write(entry.dir, entry.base, decision === 'deny' ? 'deny' : 'allow', reason)
  }

  private write(dir: string, base: string, kind: 'allow' | 'deny', reason?: string): void {
    const payload = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: kind,
        permissionDecisionReason:
          reason ?? (kind === 'allow' ? '사용자가 승인했습니다.' : '사용자가 거부했습니다.'),
      },
    }
    const res = join(dir, `${base}.res.json`)
    // hook 이 부분 파일을 읽지 않도록 임시 파일 → 이동
    writeFileSync(`${res}.tmp`, JSON.stringify(payload), 'utf8')
    renameSync(`${res}.tmp`, res)
  }

  private poll(runId: string): void {
    const w = this.watched.get(runId)
    if (!w) return
    const { sessionId } = w

    let files: string[]
    try {
      files = readdirSync(w.dir)
    } catch {
      return
    }

    for (const f of files) {
      if (!f.endsWith('.req.json')) continue
      const base = f.slice(0, -'.req.json'.length)
      if (w.seen.has(base)) continue

      let raw: string
      try {
        raw = readFileSync(join(w.dir, f), 'utf8')
      } catch {
        continue // 아직 이동 중
      }

      let hook: any
      try {
        hook = JSON.parse(raw)
      } catch {
        continue // 부분 기록
      }

      w.seen.add(base)

      const tool: string = hook.tool_name ?? 'unknown'
      const input = hook.tool_input ?? {}
      const cwd: string = hook.cwd ?? ''

      // Allow for Session 으로 이미 허용한 도구는 묻지 않는다
      if (w.autoApprove || w.sessionAllowed.has(tool)) {
        this.write(w.dir, base, 'allow', w.autoApprove ? '세션 자동 승인' : '세션 허용됨')
        continue
      }

      const id = `${base}::${tool}`
      this.open.set(id, { dir: w.dir, base, sessionId, runId })

      // hook 이 자체 타임아웃으로 빠져나가면 응답 파일이 소비되지 않는다.
      // 앱에는 pending 으로 알려 UI 알림을 닫고 세션 기록에 timeout 을 남긴다.
      setTimeout(() => {
        if (this.open.has(id)) {
          this.onRequest({ ...this.describe(id, sessionId, runId, tool, input, cwd), pending: true })
        }
      }, 285_000)

      this.onRequest(this.describe(id, sessionId, runId, tool, input, cwd))
    }
  }

  private describe(
    id: string,
    sessionId: string,
    runId: string,
    tool: string,
    input: unknown,
    cwd: string,
  ): ApprovalRequest {
    return {
      id,
      sessionId,
      runId,
      tool,
      input,
      cwd,
      risk: assessRisk(tool, input, cwd),
      pending: false,
    }
  }
}

/** 사전 권한 정책의 위험도 판정 */
export function assessRisk(tool: string, input: unknown, cwd: string): RiskLevel {
  if (tool === 'Bash' || tool === 'PowerShell') return 'high'
  if (/^(Write|Edit|NotebookEdit)$/.test(tool)) {
    const p = (input as { file_path?: string })?.file_path
    if (p && cwd && !isPathInside(p, cwd)) return 'high'
    return 'med'
  }
  return 'low'
}

function isPathInside(filePath: string, cwd: string): boolean {
  const target = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath)
  const root = resolve(cwd)
  const rel = relative(root, target)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

export const APPROVAL_HOLD_REASON = HOLD_REASON
