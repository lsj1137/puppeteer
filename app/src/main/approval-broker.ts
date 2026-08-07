import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { ApprovalDecision, ApprovalRequest, RiskLevel } from '@shared/session'

const HOLD_REASON =
  '사용자 응답 대기 시간 초과. 이 작업은 보류되었습니다. 세션을 종료하지 말고, 다른 진행 가능한 작업을 하거나 사용자 지시를 기다리세요.'

interface Watched {
  dir: string
  sessionId: string
  timer: NodeJS.Timeout
  /** Allow for Session 으로 통과시킬 도구 이름 */
  sessionAllowed: Set<string>
  seen: Set<string>
}

/**
 * hook 이 남긴 승인 요청 파일을 감시하고, 사용자의 결정을 응답 파일로 되돌려준다.
 * WSL2 는 NAT 라 WSL→Windows localhost 가 통하지 않으므로 HTTP 대신 파일로 주고받는다.
 */
export class ApprovalBroker {
  private watched = new Map<string, Watched>()
  /** 승인 ID → 응답 파일 경로 */
  private open = new Map<string, { dir: string; base: string; sessionId: string }>()

  constructor(private readonly onRequest: (req: ApprovalRequest) => void) {}

  attach(sessionId: string, dir: string): void {
    mkdirSync(dir, { recursive: true })

    // 같은 세션에 이어서 지시하면 attach 가 다시 불린다.
    // 그대로 두면 타이머가 하나 더 돌고, 세션 단위 허용이 매 턴 초기화된다.
    const prev = this.watched.get(sessionId)
    if (prev) {
      prev.dir = dir
      return
    }

    this.watched.set(sessionId, {
      dir,
      sessionId,
      sessionAllowed: new Set(),
      seen: new Set(),
      timer: setInterval(() => this.poll(sessionId), 200),
    })
  }

  detach(sessionId: string): void {
    const w = this.watched.get(sessionId)
    if (!w) return
    clearInterval(w.timer)
    this.watched.delete(sessionId)
    for (const [id, entry] of this.open) {
      if (entry.sessionId === sessionId) this.open.delete(id)
    }
    try {
      rmSync(w.dir, { recursive: true, force: true })
    } catch {
      // 정리 실패는 무시
    }
  }

  /** 사용자의 결정을 hook 에 돌려준다 */
  resolve(approvalId: string, decision: ApprovalDecision, reason?: string): void {
    const entry = this.open.get(approvalId)
    if (!entry) return
    this.open.delete(approvalId)

    if (decision === 'allow-session') {
      const w = this.watched.get(entry.sessionId)
      const tool = approvalId.split('::')[1]
      if (w && tool) w.sessionAllowed.add(tool)
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

  private poll(sessionId: string): void {
    const w = this.watched.get(sessionId)
    if (!w) return

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
      if (w.sessionAllowed.has(tool)) {
        this.write(w.dir, base, 'allow', '세션 허용됨')
        continue
      }

      const id = `${base}::${tool}`
      this.open.set(id, { dir: w.dir, base, sessionId })

      // hook 이 자체 타임아웃으로 빠져나가면 응답 파일이 소비되지 않는다.
      // 앱에는 pending 으로 알려 UI 알림을 닫고 세션 기록에 timeout 을 남긴다.
      setTimeout(() => {
        if (this.open.has(id)) this.onRequest({ ...this.describe(id, sessionId, tool, input, cwd), pending: true })
      }, 285_000)

      this.onRequest(this.describe(id, sessionId, tool, input, cwd))
    }
  }

  private describe(
    id: string,
    sessionId: string,
    tool: string,
    input: unknown,
    cwd: string,
  ): ApprovalRequest {
    return { id, sessionId, tool, input, cwd, risk: assessRisk(tool, input, cwd), pending: false }
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
