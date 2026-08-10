import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
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
  SessionDeleteResult,
  SessionStatus,
  SessionWorktree,
  StoredSession,
  WorktreeCommitResult,
  WorktreeCleanupResult,
  WorktreeConflictFile,
  WorktreeMergeResult,
  WorktreeRebaseResult,
  WorktreeRebaseStrategy,
  WorktreeResolvedFile,
  WorktreeStatus,
  WorktreeIntegrationMode,
  WorktreeIntegrationReport,
} from '@shared/session'
import { ClaudeCliAdapter } from './adapters/claude-cli'
import { CodexCliAdapter } from './adapters/codex-cli'
import { ApprovalBroker } from './approval-broker'
import { hookCommand, toRunnerPath } from './paths'
import * as library from './agent-library'
import * as db from './db'
import {
  addWorktree,
  abortWorktreeRebase as abortGitWorktreeRebase,
  changedSince,
  commitWorktree as commitGitWorktree,
  diffFile,
  mergeWorktree as mergeGitWorktree,
  worktreeHeadCommitTime,
  rebaseWorktree as rebaseGitWorktree,
  resolveWorktreeConflicts as resolveGitWorktreeConflicts,
  removeWorktree,
  snapshot,
  worktreeDiff as readWorktreeDiff,
  worktreeConflictFile as readWorktreeConflictFile,
  worktreeDirty,
  worktreeStatus as inspectWorktree,
} from './git'
import { notifyApproval, notifyStatus } from './notify'
import * as memory from './memory'
import { extractMemoryProposals, MEMORY_PROPOSAL_INSTRUCTION } from './memory-proposal'
import { prompt as skillPrompt } from './skill-library'
import {
  sessionDeletionBlockReason,
  shouldCreateWorktree,
  worktreeBranchName,
} from './worktree-policy'
import { nextWorktreeIntegrationStep } from './worktree-integration'
import { generateCommitMessage } from '@shared/commit-message'

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
  /** 새 세션을 전용 worktree 에서 격리할지. 생략하면 기본으로 격리한다. */
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
  memoryTargets: Partial<Record<'project' | 'agent', string>>
}

const TERMINAL: SessionStatus[] = ['completed', 'failed', 'stopped', 'auth-required']

/** 세션 생명주기 관리. 모든 이벤트를 DB 에 적재하고 렌더러로 중계한다. */
export class SessionManager {
  private sessions = new Map<string, LiveSession>()
  private integratingWorktrees = new Set<string>()
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

    /** 새 세션은 기본 격리한다. 정리한 격리 세션은 현재 원본 HEAD에서 다시 격리한다. */
    let worktree = (prev?.worktree ?? undefined) as SessionWorktree | undefined
    const recreateCleanedWorktree = Boolean(prev?.worktreeCleaned && !prev.worktree)
    if (
      !worktree &&
      shouldCreateWorktree(input.isolate, Boolean(prev), recreateCleanedWorktree)
    ) {
      const originSnapshot = await snapshot(input.cwd)
      const dir = join(app.getPath('userData'), 'worktrees', id)
      const branch = worktreeBranchName(id, recreateCleanedWorktree ? Date.now() : undefined)
      const made = await addWorktree(input.cwd, dir, branch)
      if (made) {
        worktree = { ...made, origin: input.cwd }
        db.setWorktree(id, worktree)
        this.persistAndSend(id, {
          t: 'artifact',
          kind: 'log',
          path: made.path,
          content: `격리 실행\n브랜치: ${made.branch}\n경로: ${made.path}`,
        })
        if (recreateCleanedWorktree) {
          this.persistAndSend(id, {
            t: 'notice',
            level: 'info',
            title: '새 Worktree 생성',
            text: '정리된 세션을 이어가기 위해 현재 원본 HEAD에서 새 worktree를 만들었습니다.',
          })
        }
        const excluded =
          (originSnapshot?.modified.length ?? 0) + (originSnapshot?.untracked.length ?? 0)
        if (excluded > 0) {
          this.persistAndSend(id, {
            t: 'notice',
            level: 'warning',
            title: '원본 폴더의 변경은 제외됨',
            text: `원본 프로젝트에 커밋되지 않은 파일 ${excluded}개가 있습니다. worktree는 현재 HEAD에서 만들어져 이 변경을 포함하지 않습니다.`,
          })
        }
      } else {
        this.persistAndSend(id, {
          t: 'notice',
          level: 'warning',
          title: 'Worktree 자동 분리 실패',
          text: recreateCleanedWorktree
            ? '정리된 세션의 새 worktree를 만들지 못해 현재 폴더에서 진행합니다. 원본 변경 여부를 확인해 주세요.'
            : 'Git 저장소가 아니거나 worktree를 만들 수 없어 현재 폴더에서 진행합니다.',
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
      memoryTargets: Object.fromEntries(
        memory.list([input.runner], [input.cwd])
          .filter((entry) => entry.scope === 'project' || (entry.scope === 'agent' && entry.id === `agent:${input.agentName}`))
          .map((entry) => [entry.scope, entry.id]),
      ),
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
    const skills = skillPrompt(input.cwd, agent, (path) => toRunnerPath(path, input.runner))

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
      systemPrompt: [MEMORY_PROPOSAL_INSTRUCTION, skills].filter(Boolean).join('\n\n---\n\n'),
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
  async remove(sessionId: string): Promise<SessionDeleteResult> {
    const live = this.sessions.get(sessionId)
    if (live) {
      live.adapter.stop()
      this.broker.detach(sessionId)
      this.sessions.delete(sessionId)
    }

    // 코드가 남은 worktree는 세션과 함께 추적돼야 한다. 미커밋/미병합 작업이 있으면
    // 세션 삭제도 중단하고 Worktree 관리 화면에서 먼저 정리하게 한다.
    const stored = db.getSession(sessionId)
    const wt = stored?.worktree
    if (wt) {
      const dirty = await worktreeDirty(wt.path)
      const status = await inspectWorktree(wt)
      const blocked = sessionDeletionBlockReason(dirty, status)
      if (blocked) return { ok: false, message: blocked }
      const cleanup = await removeWorktree(wt.origin, wt.path, wt.branch)
      if (!cleanup.ok) {
        return { ok: false, message: `${cleanup.message} 세션 삭제를 중단했습니다.` }
      }
    }

    db.deleteSession(sessionId)
    return { ok: true }
  }

  /** 격리 실행 중인 세션의 worktree 정보 */
  worktreeOf(sessionId: string): SessionWorktree | undefined {
    return db.getSession(sessionId)?.worktree ?? undefined
  }

  /** worktree 를 사용자가 직접 정리할 때 */
  async dropWorktree(sessionId: string, force: boolean): Promise<WorktreeCleanupResult> {
    const wt = db.getSession(sessionId)?.worktree
    if (!wt) return { ok: false, message: '이 세션에 연결된 worktree가 없습니다.' }
    if (this.sessions.has(sessionId)) {
      return {
        ok: false,
        message: '세션이 실행 중이라 worktree를 정리할 수 없습니다. 작업을 중지하거나 완료한 뒤 다시 시도해 주세요.',
      }
    }
    const result = await removeWorktree(wt.origin, wt.path, wt.branch, force)
    if (result.ok) db.setWorktree(sessionId, null)
    return result
  }

  async worktreeStatus(sessionId: string): Promise<WorktreeStatus | undefined> {
    const stored = db.getSession(sessionId)
    const wt = stored?.worktree
    if (!wt) return undefined
    const inspected = await inspectWorktree(wt)
    let integration = db.getWorktreeIntegration(sessionId)
    const staleInProgress = Boolean(
      integration &&
        ['checking', 'committing', 'merging'].includes(integration.phase) &&
        Date.now() - integration.updatedAt > 30_000,
    )
    const mode = db.getSetting('worktree_integration_mode') === 'suggest' ? 'suggest' : 'auto'
    const pendingStep = nextWorktreeIntegrationStep(mode, inspected)
    // 이전 버그/구버전이 dirty 상태를 "이미 반영됨"으로 skipped 저장했더라도
    // 현재 정책상 할 일이 있으면 Worktree 화면 조회 시 다시 복구한다.
    const incorrectlySkipped = integration?.phase === 'skipped' && pendingStep !== 'none'
    if (
      (!integration || staleInProgress || incorrectlySkipped) &&
      stored.status === 'completed' &&
      !this.sessions.has(sessionId) &&
      pendingStep !== 'none'
    ) {
      integration = {
        mode,
        phase: 'checking',
        summary: staleInProgress
          ? '중단된 자동 반영 작업을 다시 확인하고 있습니다.'
          : incorrectlySkipped
            ? '잘못 건너뛴 자동 반영 작업을 다시 확인하고 있습니다.'
            : '누락된 자동 반영 기록을 복구하고 있습니다.',
        worktreePath: wt.path,
        updatedAt: Date.now(),
        status: integrationStatus(inspected),
      }
      void this.integrateWorktree(sessionId)
    }
    const status = { ...inspected, integration }
    if (this.sessions.has(sessionId)) {
      return {
        ...status,
        canMerge: false,
        reason: '세션이 실행 중입니다. 작업이 끝난 뒤 병합해 주세요.',
      }
    }
    return status
  }

  async worktreeDiff(sessionId: string): Promise<string> {
    const wt = db.getSession(sessionId)?.worktree
    if (!wt) return '(이 세션에 연결된 worktree가 없습니다.)'
    return readWorktreeDiff(wt)
  }

  async worktreeConflictFile(
    sessionId: string,
    path: string,
  ): Promise<WorktreeConflictFile | undefined> {
    const wt = db.getSession(sessionId)?.worktree
    if (!wt) return undefined
    return readWorktreeConflictFile(wt, path)
  }

  async commitWorktree(sessionId: string, message: string): Promise<WorktreeCommitResult> {
    const wt = db.getSession(sessionId)?.worktree
    if (!wt) return { ok: false, message: '이 세션에 연결된 worktree가 없습니다.' }
    if (this.sessions.has(sessionId)) {
      return {
        ok: false,
        message: '세션이 실행 중입니다. 작업이 끝난 뒤 커밋해 주세요.',
        status: await this.worktreeStatus(sessionId),
      }
    }
    if (this.integratingWorktrees.has(sessionId)) {
      return {
        ok: false,
        message: '자동 커밋·병합을 처리 중입니다. 완료 후 다시 시도해 주세요.',
        status: await this.worktreeStatus(sessionId),
      }
    }
    const result = await commitGitWorktree(wt, message)
    if (result.ok) db.deleteWorktreeReviewNotices(sessionId)
    return result
  }

  async rebaseWorktree(
    sessionId: string,
    strategy?: WorktreeRebaseStrategy,
  ): Promise<WorktreeRebaseResult> {
    const wt = db.getSession(sessionId)?.worktree
    if (!wt) return { ok: false, message: '이 세션에 연결된 worktree가 없습니다.' }
    if (this.sessions.has(sessionId)) {
      return {
        ok: false,
        message: '세션이 실행 중입니다. 작업이 끝난 뒤 원본 변경을 반영해 주세요.',
        status: await this.worktreeStatus(sessionId),
      }
    }
    if (this.integratingWorktrees.has(sessionId)) {
      return {
        ok: false,
        message: '자동 커밋·병합을 처리 중입니다. 완료 후 다시 시도해 주세요.',
        status: await this.worktreeStatus(sessionId),
      }
    }
    const result = await rebaseGitWorktree(wt, strategy)
    if (result.ok && result.status?.worktree) db.setWorktree(sessionId, result.status.worktree)
    return result
  }

  async resolveWorktreeConflicts(
    sessionId: string,
    files: WorktreeResolvedFile[],
  ): Promise<WorktreeRebaseResult> {
    const wt = db.getSession(sessionId)?.worktree
    if (!wt) return { ok: false, message: '이 세션에 연결된 worktree가 없습니다.' }
    if (this.sessions.has(sessionId)) {
      return {
        ok: false,
        message: '세션이 실행 중입니다. 작업이 끝난 뒤 충돌을 해결해 주세요.',
        status: await this.worktreeStatus(sessionId),
      }
    }
    const result = await resolveGitWorktreeConflicts(wt, files)
    if (result.ok && result.status?.worktree) db.setWorktree(sessionId, result.status.worktree)
    return result
  }

  async abortWorktreeRebase(sessionId: string): Promise<boolean> {
    const wt = db.getSession(sessionId)?.worktree
    return wt ? abortGitWorktreeRebase(wt) : false
  }

  async mergeWorktree(sessionId: string): Promise<WorktreeMergeResult> {
    const wt = db.getSession(sessionId)?.worktree
    if (!wt) return { ok: false, message: '이 세션에 연결된 worktree가 없습니다.' }
    if (this.sessions.has(sessionId)) {
      return {
        ok: false,
        message: '세션이 실행 중입니다. 작업이 끝난 뒤 병합해 주세요.',
        status: await this.worktreeStatus(sessionId),
      }
    }
    if (this.integratingWorktrees.has(sessionId)) {
      return {
        ok: false,
        message: '자동 커밋·병합을 처리 중입니다. 완료 후 다시 시도해 주세요.',
        status: await this.worktreeStatus(sessionId),
      }
    }
    const result = await mergeGitWorktree(wt)
    if (result.ok) db.deleteWorktreeReviewNotices(sessionId)
    return result
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

  /** CLI 실행과 완료 후 자동 반영을 모두 포함한 종료 보호 대상 작업 수. */
  activeWorkCount(): number {
    return new Set([...this.sessions.keys(), ...this.integratingWorktrees]).size
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision, reason?: string): void {
    const openApprovals = db.listOpenApprovals()
    const approval = openApprovals.find(({ id }) => id === approvalId)
    db.decideApproval(approvalId, decision)
    this.broker.resolve(approvalId, decision, reason)
    this.getWindow()?.webContents.send('approval:cleared', approvalId)
    const hasAnotherApproval = approval && openApprovals.some(
      ({ id, sessionId }) => id !== approvalId && sessionId === approval.sessionId,
    )
    if (approval && !hasAnotherApproval && this.sessions.has(approval.sessionId)) {
      this.onEvent(approval.sessionId, { t: 'status', status: 'running' })
    }
  }

  renameSession(sessionId: string, title: string): StoredSession | undefined {
    const renamed = db.renameSession(sessionId, title)
    const live = this.sessions.get(sessionId)
    if (live && renamed?.title) live.title = renamed.title
    return renamed
  }

  private onApproval(req: ApprovalRequest): void {
    const projectPath = db.getSession(req.sessionId)?.projectPath
    const routedReq = projectPath ? { ...req, projectPath } : req
    db.recordApproval(routedReq)
    if (routedReq.pending) {
      db.decideApproval(routedReq.id, 'deny')
      this.onEvent(routedReq.sessionId, {
        t: 'notice',
        level: 'warning',
        title: '승인 요청 시간 초과',
        text: `${routedReq.tool} 요청을 건너뛰었습니다.`,
      })
      if (this.sessions.has(routedReq.sessionId)) {
        this.onEvent(routedReq.sessionId, { t: 'status', status: 'running' })
      }
      this.getWindow()?.webContents.send('approval:cleared', routedReq.id)
      return
    }
    this.getWindow()?.webContents.send('approval:request', routedReq)
    notifyApproval(routedReq)
    this.onEvent(routedReq.sessionId, { t: 'status', status: 'approval-required' })
  }

  private onEvent(sessionId: string, event: SessionEvent): void {
    const session = this.sessions.get(sessionId)
    let integrateCompletedWorktree = false

    if (event.t === 'message' && event.role === 'assistant' && !event.isError) {
      const extracted = extractMemoryProposals(event.text)
      for (const proposal of extracted.proposals) {
        const entryId = session?.memoryTargets[proposal.scope]
        if (!entryId) continue
        const recorded = db.recordMemoryProposal({ sessionId, entryId, ...proposal })
        if (recorded) this.persistAndSend(sessionId, { t: 'memory-proposal', proposal: recorded })
      }
      event = { ...event, text: extracted.text }
      if (!event.text && extracted.proposals.length > 0) return
    }

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
        for (const approvalId of db.discardOpenApprovals(sessionId)) {
          this.getWindow()?.webContents.send('approval:cleared', approvalId)
        }
        this.broker.detach(sessionId)
        this.sessions.delete(sessionId)
        integrateCompletedWorktree = event.status === 'completed'
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
    if (integrateCompletedWorktree) void this.integrateWorktree(sessionId)
  }

  /** 정상 완료된 격리 작업만 자동 커밋하고, 안전한 fast-forward일 때만 원본에 합친다. */
  private async integrateWorktree(sessionId: string): Promise<void> {
    if (this.integratingWorktrees.has(sessionId)) return
    this.integratingWorktrees.add(sessionId)
    const stored = db.getSession(sessionId)
    let wt = stored?.worktree
    if (!wt) {
      this.integratingWorktrees.delete(sessionId)
      return
    }

    const mode: WorktreeIntegrationMode =
      db.getSetting('worktree_integration_mode') === 'suggest' ? 'suggest' : 'auto'
    this.setIntegrationReport(sessionId, {
      mode,
      phase: 'checking',
      summary: '완료된 작업의 변경 상태를 확인하고 있습니다.',
      worktreePath: wt.path,
      updatedAt: Date.now(),
    })

    try {
      let status = await inspectWorktree(wt)
      let step = nextWorktreeIntegrationStep(mode, status)
      if (step === 'none') {
        this.setIntegrationReport(sessionId, {
          mode,
          phase: 'skipped',
          summary: status.merged ? '이미 원본에 반영되어 있습니다.' : '반영할 변경이 없습니다.',
          worktreePath: wt.path,
          updatedAt: Date.now(),
          status: integrationStatus(status),
        })
        return
      }
      if (step === 'suggest') {
        this.setIntegrationReport(sessionId, {
          mode,
          phase: 'needs-review',
          summary: '설정에 따라 자동 반영하지 않았습니다.',
          detail: status.reason,
          worktreePath: wt.path,
          updatedAt: Date.now(),
          status: integrationStatus(status),
        })
        this.sendMergeSuggestion(sessionId, wt.path, '설정에 따라 자동 커밋·병합하지 않았습니다.')
        return
      }

      if (step === 'commit') {
        this.setIntegrationReport(sessionId, {
          mode,
          phase: 'committing',
          summary: '변경을 작업 브랜치에 커밋하고 있습니다.',
          worktreePath: wt.path,
          updatedAt: Date.now(),
          status: integrationStatus(status),
        })
        const commitMessage = generateCommitMessage(await readWorktreeDiff(wt)).value
        const committed = await commitGitWorktree(wt, commitMessage)
        if (!committed.ok) {
          this.setIntegrationReport(sessionId, {
            mode,
            phase: 'needs-review',
            summary: '자동 커밋에 실패했습니다.',
            detail: committed.message,
            worktreePath: wt.path,
            updatedAt: Date.now(),
            status: committed.status ? integrationStatus(committed.status) : integrationStatus(status),
          })
          this.sendMergeSuggestion(sessionId, wt.path, committed.message)
          return
        }
        status = committed.status ?? (await inspectWorktree(wt))
        step = nextWorktreeIntegrationStep(mode, status)
      }

      if (step === 'none') {
        this.setIntegrationReport(sessionId, {
          mode,
          phase: status.merged ? 'completed' : 'skipped',
          summary: status.merged
            ? '원본 반영 상태를 확인했습니다.'
            : '자동 커밋 후 반영할 변경이 남지 않았습니다.',
          detail: status.reason,
          worktreePath: wt.path,
          updatedAt: Date.now(),
          status: integrationStatus(status),
        })
        return
      }
      if (step === 'rebase') {
        this.setIntegrationReport(sessionId, {
          mode,
          phase: 'merging',
          summary: '원본의 승인된 변경 위로 작업 브랜치를 재배치하고 있습니다.',
          worktreePath: wt.path,
          updatedAt: Date.now(),
          status: integrationStatus(status),
        })
        const rebased = await rebaseGitWorktree(wt)
        if (!rebased.ok) {
          // 자동 처리에서는 충돌 상태를 남기지 않는다. 사용자가 Worktree 화면에서 다시 시도한다.
          if (rebased.conflictFiles?.length) await abortGitWorktreeRebase(wt)
          status = await inspectWorktree(wt)
          this.setIntegrationReport(sessionId, {
            mode,
            phase: 'needs-review',
            summary: '원본 변경과 작업 내용이 겹쳐 자동 병합하지 않았습니다.',
            detail: rebased.message,
            worktreePath: wt.path,
            updatedAt: Date.now(),
            status: integrationStatus(status),
          })
          this.sendMergeSuggestion(sessionId, wt.path, rebased.message)
          return
        }
        if (rebased.status?.worktree) {
          wt = rebased.status.worktree
          db.setWorktree(sessionId, wt)
        }
        status = rebased.status ?? (await inspectWorktree(wt))
        step = nextWorktreeIntegrationStep(mode, status)
      }

      if (step === 'none') {
        this.setIntegrationReport(sessionId, {
          mode,
          phase: status.merged ? 'completed' : 'skipped',
          summary: status.merged
            ? '원본 반영 상태를 확인했습니다.'
            : '원본 변경 반영 후 별도로 병합할 변경이 남지 않았습니다.',
          detail: status.reason,
          worktreePath: wt.path,
          updatedAt: Date.now(),
          status: integrationStatus(status),
        })
        return
      }

      if (step !== 'merge') {
        this.setIntegrationReport(sessionId, {
          mode,
          phase: 'needs-review',
          summary: '자동 병합의 안전 조건을 충족하지 못했습니다.',
          detail: status.reason,
          worktreePath: wt.path,
          updatedAt: Date.now(),
          status: integrationStatus(status),
        })
        this.sendMergeSuggestion(
          sessionId,
          wt.path,
          status.reason ?? '자동 병합 안전 조건을 충족하지 못했습니다.',
        )
        return
      }

      this.setIntegrationReport(sessionId, {
        mode,
        phase: 'merging',
        summary: '작업 브랜치를 원본에 fast-forward 병합하고 있습니다.',
        worktreePath: wt.path,
        updatedAt: Date.now(),
        status: integrationStatus(status),
      })
      let merged = await mergeGitWorktree(wt)
      const lateStep = merged.status
        ? nextWorktreeIntegrationStep(mode, merged.status)
        : 'suggest'
      if (!merged.ok && lateStep === 'rebase' && merged.status) {
        this.setIntegrationReport(sessionId, {
          mode,
          phase: 'merging',
          summary: '병합 직전 반영된 원본 변경 위로 작업 브랜치를 다시 재배치하고 있습니다.',
          detail: merged.message,
          worktreePath: wt.path,
          updatedAt: Date.now(),
          status: integrationStatus(merged.status),
        })
        const rebased = await rebaseGitWorktree(wt)
        if (!rebased.ok) {
          if (rebased.conflictFiles?.length) await abortGitWorktreeRebase(wt)
          status = await inspectWorktree(wt)
          merged = { ok: false, message: rebased.message, status }
        } else {
          if (rebased.status?.worktree) {
            wt = rebased.status.worktree
            db.setWorktree(sessionId, wt)
          }
          status = rebased.status ?? (await inspectWorktree(wt))
          merged = nextWorktreeIntegrationStep(mode, status) === 'merge'
            ? await mergeGitWorktree(wt)
            : { ok: false, message: status.reason ?? '재배치 후 병합 조건을 확인하지 못했습니다.', status }
        }
      }
      if (!merged.ok) {
        this.setIntegrationReport(sessionId, {
          mode,
          phase: 'needs-review',
          summary: '자동 병합에 실패했습니다.',
          detail: merged.message,
          worktreePath: wt.path,
          updatedAt: Date.now(),
          status: merged.status ? integrationStatus(merged.status) : integrationStatus(status),
        })
        this.sendMergeSuggestion(sessionId, wt.path, merged.message)
        return
      }
      const commitTime = await worktreeHeadCommitTime(wt)
      const commitTimeText = commitTime
        ? new Intl.DateTimeFormat('ko-KR', {
            dateStyle: 'medium',
            timeStyle: 'medium',
          }).format(new Date(commitTime))
        : '확인할 수 없음'
      this.setIntegrationReport(sessionId, {
        mode,
        phase: 'completed',
        summary: '자동 커밋·병합을 완료했습니다.',
        detail: merged.message,
        worktreePath: wt.path,
        updatedAt: Date.now(),
        status: merged.status ? integrationStatus(merged.status) : undefined,
      })
      this.persistAndSend(sessionId, {
        t: 'notice',
        level: 'info',
        title: '자동 커밋·병합 완료',
        text: `${merged.message}\n최근 커밋 시간: ${commitTimeText}\n\n원본 프로젝트에 변경이 반영되었습니다.`,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '자동 커밋·병합 중 상태를 확인하지 못했습니다.'
      this.setIntegrationReport(sessionId, {
        mode,
        phase: 'needs-review',
        summary: '자동 반영 처리 중 오류가 발생했습니다.',
        detail: message,
        worktreePath: wt.path,
        updatedAt: Date.now(),
      })
      this.sendMergeSuggestion(
        sessionId,
        wt.path,
        message,
      )
    } finally {
      this.integratingWorktrees.delete(sessionId)
    }
  }

  private setIntegrationReport(sessionId: string, report: WorktreeIntegrationReport): void {
    db.setWorktreeIntegration(sessionId, report)
  }

  private sendMergeSuggestion(sessionId: string, worktreePath: string, reason: string): void {
    const appPath = join(worktreePath, 'app')
    const runPath = existsSync(join(appPath, 'package.json')) ? appPath : worktreePath
    const runCommand = existsSync(join(runPath, 'package.json')) ? '\nnpm run dev' : ''
    this.persistAndSend(sessionId, {
      t: 'notice',
      level: 'warning',
      title: '커밋·병합 검토 필요',
      text:
        `${reason}\n\n현재 변경을 직접 확인하려면 이 worktree에서 실행하세요:\n` +
        `cd "${runPath}"${runCommand}\n\n` +
        '확인 후 세션의 Worktree 관리에서 커밋하고 병합할 수 있습니다.',
    })
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

function integrationStatus(status: WorktreeStatus): NonNullable<WorktreeIntegrationReport['status']> {
  return {
    dirty: status.dirty,
    originDirty: status.originDirty,
    hasCommits: status.hasCommits,
    ahead: status.ahead,
    behind: status.behind,
    merged: status.merged,
    canMerge: status.canMerge,
  }
}
