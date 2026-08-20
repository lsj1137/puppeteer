import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import type {
  AgentRun,
  ApprovalDecision,
  ApprovalMode,
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
  ProjectWorktreeModeResult,
  WorktreeIntegrationReport,
} from '@shared/session'
import { ClaudeCliAdapter } from './adapters/claude-cli'
import { CodexCliAdapter } from './adapters/codex-cli'
import { ApprovalBroker } from './approval-broker'
import { approvalDirOf, hookCommand, toRunnerPath } from './paths'
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
  worktreeConnection,
  worktreeStatus as inspectWorktree,
} from './git'
import { notifyApproval, notifyStatus } from './notify'
import * as memory from './memory'
import { extractMemoryProposals, MEMORY_PROPOSAL_INSTRUCTION } from './memory-proposal'
import {
  buildDelegateResultPrompt,
  extractDelegates,
  DELEGATE_INSTRUCTION,
  MAX_SUB_RUNS,
  shouldDropPendingDelegations,
  shouldHoldForDelegation,
  SUB_RUN_TIMEOUT_MS,
  type DelegateOutcome,
  type ParsedDelegate,
} from './delegate'
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
  /** 새 세션에 지정할 모델. 이어가는 턴에는 저장된 세션 값을 쓴다. */
  model?: string | null
  /**
   * 앱이 만들어 넣는 프롬프트(보조 Agent 결과 전달 등).
   * CLI 에는 그대로 보내되 사용자 지시로 기록하지 않는다 — 지시 목록이 오염되면 안 된다.
   */
  internalPrompt?: boolean
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

/**
 * 보조 run 이 쓸 수 없는 도구.
 *
 * 쓰기 도구는 «Lead 만 파일을 고친다» 원칙 때문이고, Bash·PowerShell 은 승인 훅이 가로채는
 * 도구라 사람이 승인하기 전까지 보조가 멈춰 선다. 실제로 문서 조사 위임 2건이 Bash 승인 대기로
 * 10분 타임아웃까지 아무 일도 못 하고 끊겼다. 조사는 Read·Grep·Glob 으로 한다.
 */
const SUB_RUN_DISALLOWED = ['Write', 'Edit', 'NotebookEdit', 'Bash', 'PowerShell']

const SUB_RUN_INSTRUCTION = `당신은 다른 Agent가 위임한 조사를 수행하는 보조 실행입니다. 결과는 사람이 아니라 위임한 Agent에게 전달됩니다.
- 파일을 수정하거나 만들 수 없고 명령도 실행할 수 없습니다. Read·Grep·Glob 으로만 조사하세요.
  (Bash 를 시도하면 승인 대기로 멈춰 아무 결과도 못 냅니다.)
- 마지막 응답이 그대로 전달됩니다. 인사말 없이 확인한 내용과 근거(파일 경로·줄 번호 등)를 적으세요.
- 확인하지 못한 것은 추측하지 말고 확인하지 못했다고 적으세요.
- 다른 보조에게 다시 위임할 수 없습니다.`

/**
 * 세션마다 Lead run 은 하나뿐이라 id 를 세션에서 유도한다.
 * 이어가는 턴에서도 같은 값이 나와야 승인 폴더와 run 기록이 갈라지지 않는다.
 */
export function leadRunIdOf(sessionId: string): string {
  return `${sessionId}:lead`
}

/** runId 가 없는 과거 기록도 Lead 로 읽는다. */
function isLeadRun(sessionId: string, runId?: string): boolean {
  return !runId || runId === leadRunIdOf(sessionId)
}

/** 세션 생명주기 관리. 모든 이벤트를 DB 에 적재하고 렌더러로 중계한다. */
export class SessionManager {
  private sessions = new Map<string, LiveSession>()
  private integratingWorktrees = new Set<string>()
  /** Lead 가 이번 턴에 요청한 위임. 턴이 끝나면 꺼내서 실행한다. */
  private pendingDelegations = new Map<string, ParsedDelegate[]>()
  /** 세션이 마지막으로 쓴 실행 환경. 보조도 같은 환경에서 돌려야 한다. */
  private runners = new Map<string, DetectedRunner>()
  /** 실행 중인 보조 run. 세션을 중지하면 함께 끊는다. */
  private subAdapters = new Map<string, ClaudeCliAdapter | CodexCliAdapter>()
  /** 보조가 도는 동안 사용자가 중지를 눌렀는지 */
  private delegationCancelled = new Set<string>()
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
    const projectWorktreeMode = db.projectWorktreeMode(input.cwd)
    // 이어가는 경우 제목·생성시각·스냅샷을 그대로 둔다. 탭 이름이 매 턴 바뀌면 안 된다.
    if (!prev) {
      db.createSession({
        id,
        projectPath: input.cwd,
        runnerId: input.runner.id,
        title: input.prompt.slice(0, 80),
        agentName: input.agentName,
        model: input.model,
      })
    }

    // 사용자 지시도 이벤트로 남겨야 대화를 그대로 복원할 수 있다
    if (!input.internalPrompt) {
      this.persistAndSend(id, { t: 'message', role: 'user', messageId: `u-${id}`, text: prompt })
    }

    /** 새 세션은 기본 격리한다. 정리한 격리 세션은 현재 원본 HEAD에서 다시 격리한다. */
    let worktree = (prev?.worktree ?? undefined) as SessionWorktree | undefined
    let detachedWorktreePath: string | undefined
    if (worktree) {
      const connection = await worktreeConnection(worktree.origin, worktree.path)
      if (connection === 'unavailable') {
        throw new Error('원본 Git 저장소에서 worktree 연결 상태를 확인하지 못했습니다. 경로와 Git 상태를 확인해 주세요.')
      }
      if (connection === 'detached') {
        detachedWorktreePath = worktree.path
        db.setWorktree(id, null)
        worktree = undefined
      }
    }
    const recreateCleanedWorktree = Boolean(
      !worktree && (prev?.worktreeCleaned || detachedWorktreePath),
    )
    if (
      !worktree &&
      projectWorktreeMode !== 'off' &&
      shouldCreateWorktree(input.isolate, Boolean(prev), recreateCleanedWorktree)
    ) {
      const originSnapshot = await snapshot(input.cwd)
      const recreatedAt = recreateCleanedWorktree ? Date.now() : undefined
      // 연결이 끊긴 기존 폴더는 사용자 파일이 남아 있을 수 있으므로 덮거나 지우지 않는다.
      const dirName = recreatedAt === undefined ? id : `${id}-${recreatedAt.toString(36)}`
      const dir = join(app.getPath('userData'), 'worktrees', dirName)
      const branch = worktreeBranchName(id, recreatedAt)
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
            level: detachedWorktreePath ? 'warning' : 'info',
            title: '새 Worktree 생성',
            text: detachedWorktreePath
              ? `Git 연결이 끊긴 기존 폴더는 보존하고 현재 원본 HEAD에서 새 worktree를 만들었습니다. 기존 경로: ${detachedWorktreePath}`
              : '정리된 세션을 이어가기 위해 현재 원본 HEAD에서 새 worktree를 만들었습니다.',
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
    // 세션 저장값 > 이번 호출값. 도중에 바꾼 Agent 가 다음 턴부터 적용된다.
    const agentName = prev?.agentName ?? input.agentName ?? undefined
    const agent = agentName ? library.read(agentName) : undefined

    // 승인 요청 폴더는 run 단위로 나눈다. 보조 Agent 가 동시에 요청해도 섞이지 않아야 한다.
    const leadRunId = leadRunIdOf(id)
    db.createRun({
      id: leadRunId,
      sessionId: id,
      role: 'lead',
      agentName: input.agentName ?? null,
      runnerId: input.runner.id,
      task: input.prompt,
      status: 'starting',
      costUsd: 0,
      startedAt: Date.now(),
    })
    const approvalDir = approvalDirOf(workCwd, id, leadRunId)
    this.broker.attach(leadRunId, id, approvalDir, prev?.approvalMode === 'auto')

    // provider 에 맞는 어댑터를 고른다. 이벤트 계약은 같다.
    const adapter =
      input.runner.provider === 'codex-cli'
        ? new CodexCliAdapter((event) => this.onEvent(id, event, leadRunId))
        : new ClaudeCliAdapter((event) => this.onEvent(id, event, leadRunId))
    this.runners.set(id, input.runner)
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

    // 선언만 되고 강제되지 않는 설정은 조용히 넘기지 않는다. 새 세션에서 한 번만 알린다.
    const unenforced = agent ? library.unenforcedPathScopes(agent) : []
    if (!prev && unenforced.length > 0) {
      this.persistAndSend(id, {
        t: 'notice',
        level: 'warning',
        title: '적용되지 않는 Agent 설정',
        text:
          `«${agent?.name}» 의 ${unenforced.join('·')} 는 현재 실행에 반영되지 않습니다.\n` +
          '경로 제한은 아직 강제되지 않으니 이 Agent 가 그 범위를 벗어나 파일을 읽거나 고칠 수 있습니다.\n' +
          '도구 자체를 막으려면 allowedTools·disallowedTools 를 쓰세요.',
      })
    }

    // 세션 시작 전 git 상태를 남긴다 (실패해도 세션은 진행).
    // 이어가는 턴에는 다시 찍지 않는다 — 기준점은 대화가 시작된 시점이어야 한다.
    if (!prev) {
      void snapshot(workCwd).then((snap) => {
        if (!snap) return
        db.setSnapshot(id, snap)
        this.persistAndSend(id, { t: 'snapshot', snapshot: snap })
      })
    }

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
      agentName: agent ? agentName : undefined,
      agentsJson: agent ? library.toCliAgents(agent) : undefined,
      agentPrompt: agent ? library.toPromptPrefix(agent) : undefined,
      // 세션 지정 > Agent 지정 > CLI 기본. 세션 값은 실행 중에도 바꿀 수 있고 다음 턴부터 적용된다.
      model: (prev?.model ?? input.model)?.trim() || agent?.model,
      approvalDirHost: approvalDir,
      hooksFileRunnerPath: toRunnerPath(join(approvalDir, 'hooks.json'), input.runner),
      allowedTools: agent?.workspace.allowedTools,
      disallowedTools: agent?.workspace.disallowedTools,
      systemPrompt: [MEMORY_PROPOSAL_INSTRUCTION, DELEGATE_INSTRUCTION, skills]
        .filter(Boolean)
        .join('\n\n---\n\n'),
    })
    return id
  }

  stop(sessionId: string): void {
    this.sessions.get(sessionId)?.adapter.stop()
    // 보조가 남아 돌면 사용자는 멈춘 줄 알고 있는데 토큰이 계속 나간다.
    this.pendingDelegations.delete(sessionId)
    const prefix = `${sessionId}:sub:`
    for (const [runId, adapter] of this.subAdapters) {
      if (!runId.startsWith(prefix)) continue
      this.delegationCancelled.add(sessionId)
      adapter.stop()
    }
  }

  setAgent(sessionId: string, agentName: string | null): StoredSession | undefined {
    return db.setSessionAgentName(sessionId, agentName)
  }

  setModel(sessionId: string, model: string | null): StoredSession | undefined {
    return db.setSessionModel(sessionId, model)
  }

  setApprovalMode(sessionId: string, mode: ApprovalMode): StoredSession | undefined {
    const session = db.setSessionApprovalMode(sessionId, mode)
    this.broker.setAutoApprove(sessionId, mode === 'auto')
    return session
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
      this.broker.detachSession(sessionId)
      this.sessions.delete(sessionId)
    }
    this.stop(sessionId)
    this.runners.delete(sessionId)

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
    const connection = await worktreeConnection(wt.origin, wt.path)
    if (connection === 'unavailable') {
      return {
        ok: false,
        message: '원본 Git 저장소에서 worktree 연결 상태를 확인하지 못했습니다. 경로와 Git 상태를 확인해 주세요.',
      }
    }
    if (connection === 'detached') {
      db.setWorktree(sessionId, null)
      return {
        ok: true,
        message: `Git 연결이 이미 끊어진 worktree 기록을 정리했습니다. 기존 폴더는 보존했습니다: ${wt.path}`,
      }
    }
    const result = await removeWorktree(wt.origin, wt.path, wt.branch, force)
    if (result.ok) db.setWorktree(sessionId, null)
    return result
  }

  /** 프로젝트가 Worktree 사용을 끌 때 기존 격리 작업을 모두 안전하게 정리한다. */
  async setProjectWorktreeMode(
    projectPath: string,
    mode: WorktreeIntegrationMode,
  ): Promise<ProjectWorktreeModeResult> {
    if (mode !== 'off') {
      const project = db.setProjectWorktreeMode(projectPath, mode)
      return project
        ? { ok: true, message: '프로젝트 Worktree 정책을 변경했습니다.', project }
        : { ok: false, message: '프로젝트를 찾지 못했습니다.' }
    }

    if (this.listRunning().some(({ projectPath: path }) => path === projectPath)) {
      return { ok: false, message: '실행 중인 세션이 있어 Worktree 사용을 끌 수 없습니다.' }
    }
    const entries = db.projectWorktreeSessions(projectPath)
    const checked: Array<{ id: string; worktree: SessionWorktree; detached: boolean }> = []
    for (const entry of entries) {
      const connection = await worktreeConnection(entry.worktree.origin, entry.worktree.path)
      if (connection === 'unavailable') {
        return { ok: false, message: `Worktree 상태를 확인하지 못했습니다: ${entry.worktree.path}` }
      }
      if (connection === 'detached') {
        checked.push({ ...entry, detached: true })
        continue
      }
      const dirty = await worktreeDirty(entry.worktree.path)
      const status = await inspectWorktree(entry.worktree)
      const blocked = sessionDeletionBlockReason(dirty, status)
      if (blocked) return { ok: false, message: `${blocked}\n${entry.worktree.path}` }
      checked.push({ ...entry, detached: false })
    }

    for (const entry of checked) {
      if (!entry.detached) {
        const result = await removeWorktree(
          entry.worktree.origin,
          entry.worktree.path,
          entry.worktree.branch,
        )
        if (!result.ok) return { ok: false, message: result.message }
      }
      db.setWorktree(entry.id, null)
    }
    const project = db.setProjectWorktreeMode(projectPath, mode)
    return project
      ? { ok: true, message: `Worktree ${checked.length}개를 정리하고 사용을 껐습니다.`, project }
      : { ok: false, message: '프로젝트를 찾지 못했습니다.' }
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
    const mode = db.projectWorktreeMode(stored.projectPath)
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
    // 보조가 요청했는데 Lead 가 물어본 것처럼 보이면 사용자가 무엇을 승인하는지 알 수 없다.
    const run = req.runId ? db.listRuns(req.sessionId).find(({ id }) => id === req.runId) : undefined
    const runLabel =
      run && run.role === 'sub' ? `보조 · ${run.agentName || 'Agent 없음'}` : undefined
    const routedReq = { ...req, ...(projectPath ? { projectPath } : {}), ...(runLabel ? { runLabel } : {}) }
    db.recordApproval(routedReq)
    if (routedReq.pending) {
      db.decideApproval(routedReq.id, 'deny')
      this.onEvent(
        routedReq.sessionId,
        {
          t: 'notice',
          level: 'warning',
          title: '승인 요청 시간 초과',
          text: `${routedReq.tool} 요청을 건너뛰었습니다.`,
        },
        routedReq.runId,
      )
      if (this.sessions.has(routedReq.sessionId)) {
        this.onEvent(routedReq.sessionId, { t: 'status', status: 'running' }, routedReq.runId)
      }
      this.getWindow()?.webContents.send('approval:cleared', routedReq.id)
      return
    }
    this.getWindow()?.webContents.send('approval:request', routedReq)
    notifyApproval(routedReq)
    this.onEvent(
      routedReq.sessionId,
      { t: 'status', status: 'approval-required' },
      routedReq.runId,
    )
  }

  private onEvent(sessionId: string, event: SessionEvent, runId?: string): void {
    const session = this.sessions.get(sessionId)
    let integrateCompletedWorktree = false
    let runDelegations = false

    if (event.t === 'message' && event.role === 'assistant' && !event.isError) {
      const extracted = extractMemoryProposals(event.text)
      for (const proposal of extracted.proposals) {
        const entryId = session?.memoryTargets[proposal.scope]
        if (!entryId) continue
        const recorded = db.recordMemoryProposal({ sessionId, entryId, ...proposal })
        if (recorded) {
          this.persistAndSend(sessionId, { t: 'memory-proposal', proposal: recorded }, runId)
        }
      }
      const delegated = extractDelegates(extracted.text)
      if (delegated.delegates.length > 0 && isLeadRun(sessionId, runId)) {
        // Lead 프로세스가 아직 살아 있다. 이번 턴이 끝난 뒤에 보조를 띄운다.
        this.pendingDelegations.set(sessionId, delegated.delegates)
      }
      event = { ...event, text: delegated.text }
      if (!event.text && (extracted.proposals.length > 0 || delegated.delegates.length > 0)) return
    }

    if (event.t === 'status') {
      if (session) session.status = event.status
      db.updateSession(sessionId, { status: event.status })
      if (runId) db.updateRun(runId, { status: event.status })
      if (TERMINAL.includes(event.status)) {
        if (runId) db.updateRun(runId, { ended: true })
        for (const approvalId of db.discardOpenApprovals(sessionId)) {
          this.getWindow()?.webContents.send('approval:cleared', approvalId)
        }

        const isLead = isLeadRun(sessionId, runId)
        // 자동 반영은 Lead 가 끝났을 때만 한 번 돈다. 보조 run 종료가 원본을 건드리면 안 된다.
        const leadDone = event.status === 'completed' && isLead
        runDelegations = shouldHoldForDelegation(
          event.status,
          isLead,
          this.pendingDelegations.has(sessionId),
        )
        integrateCompletedWorktree = leadDone && !runDelegations
        if (shouldDropPendingDelegations(event.status, isLead)) {
          this.pendingDelegations.delete(sessionId)
        }

        if (runDelegations) {
          // 세션은 살려 둔다. Lead 감시만 걷고 보조는 각자 붙는다.
          this.broker.detach(leadRunIdOf(sessionId))
        } else {
          db.updateSession(sessionId, { ended: true })
          // 세션을 지우기 전에 알린다 — 지운 뒤엔 제목·경로를 알 수 없다
          const meta = session ?? db.getSession(sessionId)
          if (meta) {
            const cwd = 'projectPath' in meta ? meta.projectPath : ''
            notifyStatus(event.status, meta.title ?? '', cwd, sessionId, event.reason)
          }
          this.broker.detachSession(sessionId)
          this.sessions.delete(sessionId)
        }
      }
    }
    if (event.t === 'session-meta') {
      db.updateSession(sessionId, { cliSessionId: event.meta.cliSessionId })
    }
    if (event.t === 'usage') {
      db.updateSession(sessionId, { costUsd: event.usage.totalCostUsd })
      if (runId) db.updateRun(runId, { costUsd: event.usage.totalCostUsd })
    }
    if (event.t === 'file-changed') {
      db.recordFileChange(sessionId, event.path)
      session?.touched.add(event.path)
      this.checkConflict(sessionId, event.path)
    }

    if (runDelegations) {
      // 위임이 남았으면 대화가 끝난 게 아니다. Lead 의 완료는 기록만 하고 세션은 실행 중으로 둔다.
      // 그래야 완료 알림이 뜨지 않고, 새 지시가 기존 «다음 지시 예약» 경로로 들어간다.
      db.appendEvent(sessionId, event, runId)
      db.updateSession(sessionId, { status: 'running' })
      if (session) session.status = 'running'
      this.persistAndSend(sessionId, { t: 'status', status: 'running' }, runId)
      void this.runDelegations(sessionId)
      return
    }

    this.persistAndSend(sessionId, event, runId)
    if (integrateCompletedWorktree) void this.integrateWorktree(sessionId)
  }

  /**
   * Lead 턴이 끝난 뒤 위임을 실행하고 결과를 Lead 에게 돌려준다.
   * 보조는 읽기 전용이며, Lead 와 같은 실행 환경에서 돈다(도메인 지식이 다른 provider 로 새지 않게).
   */
  private async runDelegations(sessionId: string): Promise<void> {
    const requested = this.pendingDelegations.get(sessionId) ?? []
    this.pendingDelegations.delete(sessionId)
    this.delegationCancelled.delete(sessionId)
    const stored = db.getSession(sessionId)
    if (!stored || requested.length === 0) {
      this.settleAfterDelegation(sessionId, 'completed')
      return
    }

    const runner = this.runners.get(sessionId)
    if (!runner) {
      this.persistAndSend(sessionId, {
        t: 'notice',
        level: 'warning',
        title: '위임 실패',
        text: '실행 환경을 찾지 못해 보조 Agent를 띄우지 못했습니다.',
      })
      this.settleAfterDelegation(sessionId, 'failed')
      return
    }

    const accepted = requested.slice(0, MAX_SUB_RUNS)
    // 조용히 자르지 않는다 — 몇 건을 버렸는지 대화에 남긴다.
    if (requested.length > accepted.length) {
      this.persistAndSend(sessionId, {
        t: 'notice',
        level: 'warning',
        title: '위임 수 제한',
        text: `한 번에 ${MAX_SUB_RUNS}개까지만 실행합니다. 요청 ${requested.length}건 중 ${
          requested.length - accepted.length
        }건은 실행하지 않았습니다.`,
      })
    }

    const cwd = stored.worktree?.path ?? stored.projectPath
    this.persistAndSend(sessionId, {
      t: 'notice',
      level: 'info',
      title: '보조 Agent 실행',
      text: accepted
        .map((request, index) => `${index + 1}. ${request.agent ?? 'Agent 없음'} — ${request.task}`)
        .join('\n'),
    })

    // 병렬 조사가 목적이므로 동시에 띄운다. 하나가 실패해도 나머지 결과는 그대로 전달한다.
    const outcomes = await Promise.all(
      accepted.map((request) =>
        this.runSub(sessionId, cwd, runner, request, stored.model ?? undefined),
      ),
    )

    // 사용자가 중지했으면 Lead 를 다시 띄우지 않는다. 멈춘 줄 알았는데 살아나면 안 된다.
    if (this.delegationCancelled.delete(sessionId)) {
      this.persistAndSend(sessionId, {
        t: 'notice',
        level: 'warning',
        title: '위임 중단',
        text: '중지 요청으로 보조 Agent 결과를 전달하지 않았습니다.',
      })
      this.settleAfterDelegation(sessionId, 'stopped')
      return
    }

    // 결과는 사용자 지시가 아니라 앱이 넣는 프롬프트다.
    await this.start({
      runner,
      cwd: stored.projectPath,
      prompt: buildDelegateResultPrompt(outcomes),
      internalPrompt: true,
      continueSessionId: sessionId,
      resumeCliSessionId: db.getSession(sessionId)?.cliSessionId ?? undefined,
      agentName: stored.agentName ?? undefined,
    })
  }

  /**
   * Lead 를 다시 띄우지 못하고 위임이 끝난 경우의 마무리.
   *
   * 위임을 기다리는 동안 세션을 실행 중으로 붙잡아 뒀으므로, 여기서 풀어주지 않으면
   * 영원히 «실행 중»으로 남아 입력이 예약으로만 들어간다. 종료 처리는 평소 경로를 그대로 탄다.
   */
  private settleAfterDelegation(sessionId: string, status: SessionStatus): void {
    if (!this.sessions.has(sessionId)) return
    this.onEvent(sessionId, { t: 'status', status }, leadRunIdOf(sessionId))
  }

  /** 보조 run 하나. 마지막 assistant 응답이 Lead 에게 돌아갈 결과가 된다. */
  private async runSub(
    sessionId: string,
    cwd: string,
    runner: DetectedRunner,
    request: ParsedDelegate,
    model?: string,
  ): Promise<DelegateOutcome> {
    const runId = `${sessionId}:sub:${randomUUID().slice(0, 8)}`
    const agent = request.agent ? library.read(request.agent) : undefined

    if (request.agent && !agent) {
      return { ...request, ok: false, summary: `«${request.agent}» 를 찾지 못했습니다.` }
    }
    // Lead 와 같은 마지막 방어선. 지침 전문이 그대로 모델에 실려 나간다.
    if (agent && !library.allowsProvider(agent, runner.provider)) {
      return {
        ...request,
        ok: false,
        summary: `«${agent.name}» 는 ${runner.provider} 로 실행할 수 없습니다.`,
      }
    }

    const run: AgentRun = {
      id: runId,
      sessionId,
      role: 'sub',
      agentName: agent?.name ?? null,
      runnerId: runner.id,
      task: request.task,
      status: 'starting',
      costUsd: 0,
      startedAt: Date.now(),
    }
    db.createRun(run)
    this.persistAndSend(sessionId, { t: 'run-start', run }, runId)

    const approvalDir = approvalDirOf(cwd, sessionId, runId)
    this.broker.attach(runId, sessionId, approvalDir, db.getSession(sessionId)?.approvalMode === 'auto')

    return await new Promise<DelegateOutcome>((resolve) => {
      let answer = ''
      let costUsd = 0
      let settled = false
      let timedOut = false
      let timer: NodeJS.Timeout | undefined

      const finish = (ok: boolean, summary: string): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        db.updateRun(runId, { status: ok ? 'completed' : 'failed', ended: true })
        this.broker.detach(runId)
        this.persistAndSend(sessionId, { t: 'run-result', runId, ok, summary, costUsd }, runId)
        resolve({ ...request, ok, summary })
      }

      // Lead 가 영원히 기다리면 대화가 멈춘 것처럼 보인다. 물고 있으면 끊고 실패로 돌린다.
      const timeoutSummary = `${Math.round(SUB_RUN_TIMEOUT_MS / 60000)}분 안에 끝나지 않아 중단했습니다.`
      timer = setTimeout(() => {
        // stop() 이 곧바로 종료 상태를 올리므로 먼저 표시해 둔다.
        // 안 그러면 «작업을 시작하겠습니다» 같은 첫 문장이 결과로 둔갑한다.
        timedOut = true
        this.subAdapters.get(runId)?.stop()
        finish(false, timeoutSummary)
      }, SUB_RUN_TIMEOUT_MS)

      const adapter =
        runner.provider === 'codex-cli'
          ? new CodexCliAdapter((event) => onSubEvent(event))
          : new ClaudeCliAdapter((event) => onSubEvent(event))

      const onSubEvent = (event: SessionEvent): void => {
        // 보조의 대화·도구 이벤트는 기록만 한다. 렌더러로 흘리면 Lead 가 말한 것처럼 보인다.
        // 화면에 그리는 일은 위임 카드(다음 단계)가 맡는다.
        if (event.t === 'message' && event.role === 'assistant' && !event.isError && event.text) {
          answer = event.text
        }
        if (event.t === 'usage') {
          costUsd = event.usage.totalCostUsd
          db.updateRun(runId, { costUsd })
        }
        if (event.t === 'status') {
          db.updateRun(runId, { status: event.status })
          db.appendEvent(sessionId, event, runId)
          this.persistAndSend(sessionId, { t: 'run-status', runId, status: event.status }, runId)
          if (TERMINAL.includes(event.status)) {
            if (timedOut) finish(false, timeoutSummary)
            else finish(event.status === 'completed', answer || (event.reason ?? ''))
            return
          }
          return
        }
        db.appendEvent(sessionId, event, runId)
      }

      this.subAdapters.set(runId, adapter)
      adapter.start({
        runner,
        cwd,
        prompt: request.task,
        hookCommand: hookCommand(runner, approvalDir),
        agentName: agent ? agent.name : undefined,
        agentsJson: agent ? library.toCliAgents(agent) : undefined,
        agentPrompt: agent ? library.toPromptPrefix(agent) : undefined,
        model: model || agent?.model,
        approvalDirHost: approvalDir,
        hooksFileRunnerPath: toRunnerPath(join(approvalDir, 'hooks.json'), runner),
        allowedTools: agent?.workspace.allowedTools,
        // Agent 정의가 없어도 보조는 읽기 전용이다. 쓰기는 Lead 만 한다.
        disallowedTools: [
          ...new Set([...(agent?.workspace.disallowedTools ?? []), ...SUB_RUN_DISALLOWED]),
        ],
        systemPrompt: SUB_RUN_INSTRUCTION,
      })
    }).finally(() => {
      this.subAdapters.delete(runId)
    })
  }

  /** 정상 완료된 격리 작업만 자동 커밋하고, 안전한 fast-forward일 때만 원본에 합친다. */
  private async integrateWorktree(sessionId: string): Promise<void> {
    if (this.integratingWorktrees.has(sessionId)) return
    this.integratingWorktrees.add(sessionId)
    const stored = db.getSession(sessionId)
    if (!stored?.worktree) {
      this.integratingWorktrees.delete(sessionId)
      return
    }
    let wt = stored.worktree

    const mode: WorktreeIntegrationMode = db.projectWorktreeMode(stored.projectPath)
    if (mode === 'off') {
      this.setIntegrationReport(sessionId, {
        mode,
        phase: 'skipped',
        summary: '프로젝트 설정에서 Worktree 자동 반영을 사용하지 않습니다.',
        worktreePath: wt.path,
        updatedAt: Date.now(),
      })
      this.integratingWorktrees.delete(sessionId)
      return
    }
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

  /**
   * runId를 주면 그 run이 낸 이벤트로 기록한다. 생략하면 Lead run이다 —
   * 멀티 Agent 이전 기록도 같은 규칙으로 읽힌다.
   */
  private persistAndSend(sessionId: string, event: SessionEvent, runId?: string): void {
    db.appendEvent(sessionId, event, runId)
    this.getWindow()?.webContents.send('session:event', { sessionId, runId, event })
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
