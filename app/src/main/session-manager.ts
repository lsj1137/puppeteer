import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import type {
  ApprovalDecision,
  ApprovalRequest,
  DetectedRunner,
  GitSnapshot,
  RunningSession,
  SessionEvent,
  SessionStatus,
  SessionWorktree,
} from '@shared/session'
import { ClaudeCliAdapter } from './adapters/claude-cli'
import { CodexCliAdapter } from './adapters/codex-cli'
import { ApprovalBroker } from './approval-broker'
import { hookCommand, toRunnerPath } from './paths'
import * as library from './agent-library'
import * as db from './db'
import {
  addWorktree,
  changedSince,
  diffFile,
  removeWorktree,
  snapshot,
  worktreeDirty,
} from './git'
import { notifyApproval, notifyStatus } from './notify'

export interface StartSessionInput {
  runner: DetectedRunner
  cwd: string
  prompt: string
  /** 지정하면 해당 CLI 세션을 이어간다 */
  resumeCliSessionId?: string
  /** 첨부 이미지의 호스트 경로. 러너 경로로 변환해 프롬프트에 덧붙인다. */
  attachments?: string[]
  /** 적용할 Project Agent 이름 (.claude/agents/<name>.md) */
  agentName?: string
  /** 전용 worktree 에서 격리 실행 */
  isolate?: boolean
  /**
   * 이어서 지시하는 경우 기존 세션 id.
   * 주면 새 세션 행을 만들지 않고 그 세션에 이벤트를 계속 쌓는다.
   * (CLI 는 --resume 때마다 새 세션 id 를 주지만, 사용자에게는 대화 하나여야 한다)
   */
  continueSessionId?: string
}

interface LiveSession {
  id: string
  adapter: ClaudeCliAdapter | CodexCliAdapter
  status: SessionStatus
  projectPath: string
  title: string
  /** 이 세션이 수정한 파일 (동시 수정 감지용) */
  touched: Set<string>
}

const TERMINAL: SessionStatus[] = ['completed', 'failed', 'stopped', 'auth-required']

/** 세션 생명주기 관리. 모든 이벤트를 DB 에 적재하고 렌더러로 중계한다. */
export class SessionManager {
  private sessions = new Map<string, LiveSession>()
  private broker: ApprovalBroker

  constructor(private readonly getWindow: () => BrowserWindow | undefined) {
    this.broker = new ApprovalBroker((req) => this.onApproval(req))
  }

  async start(input: StartSessionInput): Promise<string> {
    const prev = input.continueSessionId ? db.getSession(input.continueSessionId) : undefined
    const id = prev?.id ?? randomUUID()

    // CLI 는 텍스트 프롬프트만 받으므로 이미지는 경로로 참조시킨다.
    // 러너(WSL) 기준 경로로 바꿔야 CLI 가 읽을 수 있다.
    const attach = (input.attachments ?? []).map((p) => toRunnerPath(p, input.runner))
    const prompt = attach.length
      ? `${input.prompt}\n\n첨부 이미지 (Read 도구로 확인):\n${attach.map((p) => `- ${p}`).join('\n')}`
      : input.prompt

    db.addProject(input.cwd)
    db.touchProject(input.cwd)
    // 이어가는 경우 제목·생성시각·스냅샷을 그대로 둔다. 탭 이름이 매 턴 바뀌면 안 된다.
    if (!prev) {
      db.createSession({
        id,
        projectPath: input.cwd,
        runnerId: input.runner.id,
        title: input.prompt.slice(0, 80),
        agentName: input.agentName,
      })
    }

    // 사용자 지시도 이벤트로 남겨야 대화를 그대로 복원할 수 있다
    this.persistAndSend(id, { t: 'message', role: 'user', messageId: `u-${id}`, text: prompt })

    /**
     * 격리 실행. 이어가는 턴이면 이미 만들어 둔 worktree 를 그대로 쓴다.
     * 만들지 못해도 세션은 진행한다 — 격리 실패로 작업 자체를 막을 이유는 없다.
     */
    let worktree = (prev?.worktree ?? undefined) as SessionWorktree | undefined
    if (!worktree && input.isolate) {
      const dir = join(app.getPath('userData'), 'worktrees', id)
      const made = await addWorktree(input.cwd, dir, `puppeteer/${id.slice(0, 8)}`)
      if (made) {
        worktree = { ...made, origin: input.cwd }
        db.setWorktree(id, worktree)
        this.persistAndSend(id, {
          t: 'artifact',
          kind: 'log',
          path: made.path,
          content: `격리 실행\n브랜치: ${made.branch}\n경로: ${made.path}`,
        })
      } else {
        this.persistAndSend(id, {
          t: 'message',
          role: 'assistant',
          messageId: `wt-${id}`,
          text: '격리 실행을 준비하지 못했습니다(git 저장소가 아니거나 worktree 생성 실패). 원래 폴더에서 진행합니다.',
          isError: true,
        })
      }
    }
    const workCwd = worktree?.path ?? input.cwd

    const approvalDir = join(workCwd, '.agent-workspace', 'approvals', id)
    this.broker.attach(id, approvalDir)

    // provider 에 맞는 어댑터를 고른다. 이벤트 계약은 같다.
    const adapter =
      input.runner.provider === 'codex-cli'
        ? new CodexCliAdapter((event) => this.onEvent(id, event))
        : new ClaudeCliAdapter((event) => this.onEvent(id, event))
    this.sessions.set(id, {
      id,
      adapter,
      status: 'starting',
      projectPath: input.cwd,
      title: prev?.title ?? input.prompt.slice(0, 80),
      // 이어가면 그동안 만진 파일 목록을 유지해야 동시 수정 감지가 끊기지 않는다
      touched: this.sessions.get(id)?.touched ?? new Set(),
    })

    // 세션 시작 전 git 상태를 남긴다 (실패해도 세션은 진행).
    // 이어가는 턴에는 다시 찍지 않는다 — 기준점은 대화가 시작된 시점이어야 한다.
    if (!prev) {
      void snapshot(workCwd).then((snap) => {
        if (!snap) return
        db.setSnapshot(id, snap)
        this.persistAndSend(id, { t: 'snapshot', snapshot: snap })
      })
    }

    const agent = input.agentName ? library.read(input.agentName) : undefined

    // ★ 마지막 방어선. 화면에서 걸러도 여기서 한 번 더 막는다 —
    //   지침 전문이 그대로 모델에 실려 나가므로 실수 한 번이 곧 유출이다.
    if (agent && !library.allowsProvider(agent, input.runner.provider)) {
      this.persistAndSend(id, {
        t: 'status',
        status: 'failed',
        reason:
          `«${agent.name}» 는 ${input.runner.provider} 로 실행할 수 없습니다. ` +
          '이 에이전트는 허용된 실행 환경이 지정되어 있습니다.',
      })
      return id
    }

    adapter.start({
      runner: input.runner,
      cwd: workCwd,
      prompt,
      resumeSessionId: input.resumeCliSessionId,
      hookCommand: hookCommand(input.runner, approvalDir),
      agentName: agent ? input.agentName : undefined,
      agentsJson: agent ? library.toCliAgents(agent) : undefined,
      agentPrompt: agent ? library.toPromptPrefix(agent) : undefined,
      model: agent?.model,
      approvalDirHost: approvalDir,
      hooksFileRunnerPath: toRunnerPath(join(approvalDir, 'hooks.json'), input.runner),
      allowedTools: agent?.workspace.allowedTools,
      disallowedTools: agent?.workspace.disallowedTools,
    })
    return id
  }

  stop(sessionId: string): void {
    this.sessions.get(sessionId)?.adapter.stop()
  }

  /** 세션이 만든 변경 요약 (기획서 17장) */
  async changes(sessionId: string): Promise<{ path: string; status: string }[]> {
    const session = db.getSession(sessionId)
    const snap = db.getSnapshot(sessionId) as GitSnapshot | undefined
    if (!session || !snap) return db.listFileChanges(sessionId).map((path) => ({ path, status: '?' }))
    // 격리 실행 중이면 변경은 worktree 안에 있다
    return changedSince(session.worktree?.path ?? session.projectPath, snap)
  }

  async fileDiff(sessionId: string, path: string): Promise<string> {
    const session = db.getSession(sessionId)
    if (!session) return ''
    return diffFile(session.worktree?.path ?? session.projectPath, path)
  }

  /** 실행 중이면 중지한 뒤 기록까지 삭제한다 */
  async remove(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId)
    if (live) {
      live.adapter.stop()
      this.broker.detach(sessionId)
      this.sessions.delete(sessionId)
    }

    // worktree 는 비어 있을 때만 지운다. 커밋 안 된 작업이 남아 있으면 그대로 둔다 —
    // 세션 기록을 지우는 것과 사람이 만든 코드를 지우는 것은 다른 일이다.
    const stored = db.getSession(sessionId)
    const wt = stored?.worktree
    if (wt) {
      const dirty = await worktreeDirty(wt.path)
      if (!dirty) await removeWorktree(wt.origin, wt.path)
    }

    db.deleteSession(sessionId)
  }

  /** 격리 실행 중인 세션의 worktree 정보 */
  worktreeOf(sessionId: string): SessionWorktree | undefined {
    return db.getSession(sessionId)?.worktree ?? undefined
  }

  /** worktree 를 사용자가 직접 정리할 때 */
  async dropWorktree(sessionId: string, force: boolean): Promise<boolean> {
    const wt = db.getSession(sessionId)?.worktree
    if (!wt) return false
    const ok = await removeWorktree(wt.origin, wt.path, force)
    if (ok) db.setWorktree(sessionId, null)
    return ok
  }

  /** 지금 살아 있는 세션 (프로젝트를 넘나들며 표시하기 위해) */
  listRunning(): RunningSession[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      projectPath: s.projectPath,
      title: s.title,
      status: s.status,
    }))
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision, reason?: string): void {
    db.decideApproval(approvalId, decision)
    this.broker.resolve(approvalId, decision, reason)
    this.getWindow()?.webContents.send('approval:cleared', approvalId)
  }

  private onApproval(req: ApprovalRequest): void {
    db.recordApproval(req)
    if (req.pending) {
      db.decideApproval(req.id, 'deny')
      this.getWindow()?.webContents.send('approval:cleared', req.id)
      this.onEvent(req.sessionId, {
        t: 'notice',
        level: 'warning',
        title: '승인 요청 시간 초과',
        text:
          `${req.tool} 승인 요청이 응답 대기 시간을 넘겨 자동으로 닫혔습니다.\n` +
          'CLI에는 해당 작업이 거절/보류되었다고 전달했습니다.\n\n' +
          summarizeApproval(req.input),
      })
      return
    }
    this.getWindow()?.webContents.send('approval:request', req)
    notifyApproval(req)
    this.onEvent(req.sessionId, { t: 'status', status: 'approval-required' })
  }

  private onEvent(sessionId: string, event: SessionEvent): void {
    const session = this.sessions.get(sessionId)

    if (event.t === 'status') {
      if (session) session.status = event.status
      db.updateSession(sessionId, { status: event.status })
      if (TERMINAL.includes(event.status)) {
        db.updateSession(sessionId, { ended: true })
        // 세션을 지우기 전에 알린다 — 지운 뒤엔 제목·경로를 알 수 없다
        const meta = session ?? db.getSession(sessionId)
        if (meta) {
          const cwd = 'projectPath' in meta ? meta.projectPath : ''
          notifyStatus(event.status, meta.title ?? '', cwd, sessionId, event.reason)
        }
        this.broker.detach(sessionId)
        this.sessions.delete(sessionId)
      }
    }
    if (event.t === 'session-meta') {
      db.updateSession(sessionId, { cliSessionId: event.meta.cliSessionId })
    }
    if (event.t === 'usage') {
      db.updateSession(sessionId, { costUsd: event.usage.totalCostUsd })
    }
    if (event.t === 'file-changed') {
      db.recordFileChange(sessionId, event.path)
      session?.touched.add(event.path)
      this.checkConflict(sessionId, event.path)
    }

    this.persistAndSend(sessionId, event)
  }

  /**
   * 같은 파일을 건드린 다른 '살아 있는' 세션이 있을 때만 경고한다.
   * 파일 워처만으로는 누가 바꿨는지 알 수 없어 오탐이 잦으므로,
   * 세션의 실제 수정 기록이 겹칠 때로 한정한다. (기획서 15장)
   */
  private checkConflict(sessionId: string, path: string): void {
    for (const other of this.sessions.values()) {
      if (other.id === sessionId) continue
      if (!other.touched.has(path)) continue
      this.persistAndSend(sessionId, {
        t: 'conflict',
        path,
        otherSessionId: other.id,
        otherTitle: other.title,
      })
      this.persistAndSend(other.id, {
        t: 'conflict',
        path,
        otherSessionId: sessionId,
        otherTitle: this.sessions.get(sessionId)?.title ?? '',
      })
      return
    }
  }

  private persistAndSend(sessionId: string, event: SessionEvent): void {
    db.appendEvent(sessionId, event)
    this.getWindow()?.webContents.send('session:event', { sessionId, event })
  }
}

function summarizeApproval(input: unknown): string {
  const text = JSON.stringify(input, null, 2)
  return text.length <= 600 ? text : `${text.slice(0, 600)}\n…`
}
