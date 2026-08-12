import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AgentDef,
  ApprovalDecision,
  ApprovalRequest,
  ChangedFile,
  GitHistoryEntry,
  CostTotals,
  ProjectStat,
  ProjectRelinkResult,
  ProjectFileEntry,
  ProjectFilePreview,
  DetectedRunner,
  RouteResult,
  FetchedAgent,
  UpdateCheck,
  MemoryEntry,
  MemoryEdit,
  MemoryProposal,
  SkillDef,
  CheckpointDraft,
  RunningSession,
  SessionEvent,
  SessionDeleteResult,
  StoredEvent,
  StoredProject,
  StoredSession,
  WorktreeCommitResult,
  WorktreeCleanupResult,
  WorktreeConflictFile,
  WorktreeConflictResolverRequest,
  WorktreeMergeResult,
  WorktreeRebaseResult,
  WorktreeRebaseStrategy,
  WorktreeResolvedFile,
  WorktreeStatus,
  WorktreeIntegrationMode,
} from '@shared/session'
import type { AppUpdateState } from '@shared/app-update'

export interface SessionEventEnvelope {
  sessionId: string
  event: SessionEvent
}

export interface StartSessionArgs {
  runner: DetectedRunner
  cwd: string
  prompt: string
  resumeCliSessionId?: string
  /** 첨부 이미지의 호스트 경로 목록 */
  attachments?: string[]
  /** 적용할 Project Agent 이름 */
  agentName?: string
  /** 새 세션을 전용 worktree 에서 격리할지. 생략하면 기본으로 격리한다. */
  isolate?: boolean
  /** 이어서 지시하는 경우 기존 세션 id (새 세션을 만들지 않는다) */
  continueSessionId?: string
}

const api = {
  appUpdateState: (): Promise<AppUpdateState> => ipcRenderer.invoke('app-update:state'),
  checkAppUpdate: (): Promise<AppUpdateState> => ipcRenderer.invoke('app-update:check'),
  downloadAppUpdate: (): Promise<AppUpdateState> => ipcRenderer.invoke('app-update:download'),
  installAppUpdate: (): Promise<void> => ipcRenderer.invoke('app-update:install'),
  onAppUpdateState: (cb: (state: AppUpdateState) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, state: AppUpdateState): void => cb(state)
    ipcRenderer.on('app-update:state', listener)
    return () => ipcRenderer.off('app-update:state', listener)
  },

  detectRunners: (): Promise<DetectedRunner[]> => ipcRenderer.invoke('runner:detect'),

  pickProject: (): Promise<string | undefined> => ipcRenderer.invoke('project:pick'),

  listProjects: (): Promise<StoredProject[]> => ipcRenderer.invoke('project:list'),
  reorderProjects: (paths: string[]): Promise<void> => ipcRenderer.invoke('project:reorder', paths),
  renameProject: (path: string, alias: string): Promise<StoredProject | undefined> =>
    ipcRenderer.invoke('project:rename', path, alias),
  relinkProject: (path: string): Promise<ProjectRelinkResult> =>
    ipcRenderer.invoke('project:relink', path),
  removeProject: (path: string): Promise<void> => ipcRenderer.invoke('project:remove', path),
  setProjectRunner: (path: string, runnerId: string): Promise<void> =>
    ipcRenderer.invoke('project:setRunner', path, runnerId),

  listSessions: (projectPath: string): Promise<StoredSession[]> =>
    ipcRenderer.invoke('session:list', projectPath),
  listHiddenSessions: (projectPath: string): Promise<StoredSession[]> =>
    ipcRenderer.invoke('session:listHidden', projectPath),
  reorderSessions: (projectPath: string, ids: string[]): Promise<void> =>
    ipcRenderer.invoke('session:reorder', projectPath, ids),
  setSessionHidden: (sessionId: string, hidden: boolean): Promise<StoredSession | undefined> =>
    ipcRenderer.invoke('session:setHidden', sessionId, hidden),
  getSession: (sessionId: string): Promise<StoredSession | undefined> =>
    ipcRenderer.invoke('session:get', sessionId),
  renameSession: (sessionId: string, title: string): Promise<StoredSession | undefined> =>
    ipcRenderer.invoke('session:rename', sessionId, title),
  listEvents: (sessionId: string): Promise<StoredEvent[]> =>
    ipcRenderer.invoke('session:events', sessionId),
  listOpenApprovals: (): Promise<ApprovalRequest[]> => ipcRenderer.invoke('approval:open'),
  listRunningSessions: (): Promise<RunningSession[]> => ipcRenderer.invoke('session:running'),
  costTotals: (): Promise<CostTotals> => ipcRenderer.invoke('cost:totals'),
  setNotifyEnabled: (v: boolean): Promise<void> => ipcRenderer.invoke('notify:setEnabled', v),
  worktreeIntegrationMode: (): Promise<WorktreeIntegrationMode> =>
    ipcRenderer.invoke('worktree:integrationMode'),
  setWorktreeIntegrationMode: (mode: WorktreeIntegrationMode): Promise<void> =>
    ipcRenderer.invoke('worktree:setIntegrationMode', mode),
  /** 알림을 눌러 들어온 경우 그 세션으로 이동 */
  onNotifyJump: (cb: (j: { sessionId: string; cwd: string }) => void): (() => void) => {
    const h = (_e: IpcRendererEvent, j: { sessionId: string; cwd: string }): void => cb(j)
    ipcRenderer.on('notify:jump', h)
    return () => ipcRenderer.removeListener('notify:jump', h)
  },

  /** 전역 라이브러리의 에이전트 전부 */
  listAgents: (): Promise<AgentDef[]> => ipcRenderer.invoke('agent:list'),
  /** 아직 라이브러리로 안 옮긴 프로젝트 파일들 (가져오기 후보) */
  scanProjectAgents: (projectPath: string): Promise<AgentDef[]> =>
    ipcRenderer.invoke('agent:scan', projectPath),
  saveAgent: (agent: AgentDef): Promise<string> => ipcRenderer.invoke('agent:save', agent),
  deleteAgent: (name: string): Promise<void> => ipcRenderer.invoke('agent:delete', name),
  importAgent: (projectPath: string, name: string): Promise<AgentDef | undefined> =>
    ipcRenderer.invoke('agent:import', projectPath, name),
  exportAgent: (
    name: string,
    projectPath: string,
    format: 'claude-agent' | 'codex-skill' = 'claude-agent',
  ): Promise<string | undefined> => ipcRenderer.invoke('agent:export', name, projectPath, format),
  fetchAgentFromUrl: (url: string): Promise<FetchedAgent> =>
    ipcRenderer.invoke('agent:fetchUrl', url),
  fetchAgentFromFile: (): Promise<FetchedAgent | undefined> => ipcRenderer.invoke('agent:fetchFile'),
  checkAgentUpdate: (name: string): Promise<UpdateCheck> =>
    ipcRenderer.invoke('agent:checkUpdate', name),
  applyAgentUpdate: (
    name: string,
    opts: { tools?: string[]; model?: string | null },
  ): Promise<AgentDef | undefined> => ipcRenderer.invoke('agent:applyUpdate', name, opts),
  dropWorktree: (sessionId: string, force: boolean): Promise<WorktreeCleanupResult> =>
    ipcRenderer.invoke('session:dropWorktree', sessionId, force),
  worktreeStatus: (sessionId: string): Promise<WorktreeStatus | undefined> =>
    ipcRenderer.invoke('session:worktreeStatus', sessionId),
  worktreeDiff: (sessionId: string): Promise<string> =>
    ipcRenderer.invoke('session:worktreeDiff', sessionId),
  worktreeConflictFile: (
    sessionId: string,
    path: string,
  ): Promise<WorktreeConflictFile | undefined> =>
    ipcRenderer.invoke('session:worktreeConflictFile', sessionId, path),
  openWorktreeConflictResolver: (sessionId: string, files: string[]): Promise<string> =>
    ipcRenderer.invoke('session:openWorktreeConflictResolver', sessionId, files),
  conflictResolverRequest: (
    token: string,
  ): Promise<WorktreeConflictResolverRequest | undefined> =>
    ipcRenderer.invoke('session:conflictResolverRequest', token),
  resolveWorktreeConflicts: (
    sessionId: string,
    files: WorktreeResolvedFile[],
  ): Promise<WorktreeRebaseResult> =>
    ipcRenderer.invoke('session:resolveWorktreeConflicts', sessionId, files),
  onWorktreeResolved: (cb: (sessionId: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, sessionId: string): void => cb(sessionId)
    ipcRenderer.on('worktree:resolved', listener)
    return () => ipcRenderer.off('worktree:resolved', listener)
  },
  onWorktreeRebaseAborted: (cb: (sessionId: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, sessionId: string): void => cb(sessionId)
    ipcRenderer.on('worktree:rebaseAborted', listener)
    return () => ipcRenderer.off('worktree:rebaseAborted', listener)
  },
  commitWorktree: (sessionId: string, message: string): Promise<WorktreeCommitResult> =>
    ipcRenderer.invoke('session:commitWorktree', sessionId, message),
  rebaseWorktree: (
    sessionId: string,
    strategy?: WorktreeRebaseStrategy,
  ): Promise<WorktreeRebaseResult> => ipcRenderer.invoke('session:rebaseWorktree', sessionId, strategy),
  mergeWorktree: (sessionId: string): Promise<WorktreeMergeResult> =>
    ipcRenderer.invoke('session:mergeWorktree', sessionId),
  buildCheckpoint: (sessionId: string): Promise<CheckpointDraft | undefined> =>
    ipcRenderer.invoke('checkpoint:build', sessionId),
  listMemories: (): Promise<MemoryEntry[]> => ipcRenderer.invoke('memory:list'),
  readMemory: (id: string): Promise<string> => ipcRenderer.invoke('memory:read', id),
  saveMemory: (id: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('memory:save', id, content),
  promoteMemoryToGlobal: (
    sourceId: string,
    targetId: string,
    content: string,
  ): Promise<{ ok: boolean; added?: boolean; message?: string }> =>
    ipcRenderer.invoke('memory:promoteGlobal', sourceId, targetId, content),
  memoryHistory: (entryId?: string): Promise<MemoryEdit[]> =>
    ipcRenderer.invoke('memory:history', entryId),
  memoryProposals: (): Promise<MemoryProposal[]> => ipcRenderer.invoke('memory:proposals'),
  approveMemoryProposal: (id: number): Promise<boolean> =>
    ipcRenderer.invoke('memory:proposal:approve', id),
  rejectMemoryProposal: (id: number): Promise<void> =>
    ipcRenderer.invoke('memory:proposal:reject', id),
  listSkills: (): Promise<SkillDef[]> => ipcRenderer.invoke('skill:list'),
  saveSkill: (skill: SkillDef): Promise<SkillDef> => ipcRenderer.invoke('skill:save', skill),
  deleteSkill: (skill: SkillDef): Promise<void> => ipcRenderer.invoke('skill:delete', skill),
  routeInstruction: (instruction: string, runner: DetectedRunner, cwd: string): Promise<RouteResult> =>
    ipcRenderer.invoke('agent:route', instruction, runner, cwd),
  overviewStats: (): Promise<{
    projects: ProjectStat[]
    recent: StoredSession[]
    cost: CostTotals
  }> => ipcRenderer.invoke('overview:stats'),
  revealProject: (path: string): Promise<string> => ipcRenderer.invoke('project:reveal', path),
  listProjectFiles: (path: string): Promise<ProjectFileEntry[]> =>
    ipcRenderer.invoke('project:files', path),
  isGitRepository: (path: string): Promise<boolean> => ipcRenderer.invoke('project:isGit', path),
  gitHistory: (path: string, limit = 50): Promise<GitHistoryEntry[]> =>
    ipcRenderer.invoke('project:gitHistory', path, limit),
  readProjectFile: (root: string, path: string): Promise<ProjectFilePreview> =>
    ipcRenderer.invoke('project:readFile', root, path),
  listChanges: (sessionId: string): Promise<ChangedFile[]> =>
    ipcRenderer.invoke('session:changes', sessionId),
  fileDiff: (sessionId: string, path: string): Promise<string> =>
    ipcRenderer.invoke('session:diff', sessionId, path),
  saveAttachment: (projectPath: string, fileName: string, dataBase64: string): Promise<string> =>
    ipcRenderer.invoke('attachment:save', projectPath, fileName, dataBase64),

  startSession: (args: StartSessionArgs): Promise<string> =>
    ipcRenderer.invoke('session:start', args),

  stopSession: (id: string): Promise<void> => ipcRenderer.invoke('session:stop', id),
  deleteSession: (id: string): Promise<SessionDeleteResult> => ipcRenderer.invoke('session:delete', id),

  resolveApproval: (id: string, decision: ApprovalDecision, reason?: string): Promise<void> =>
    ipcRenderer.invoke('approval:resolve', id, decision, reason),

  /** 승인 요청 구독 */
  onApprovalRequest: (cb: (req: ApprovalRequest) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, req: ApprovalRequest): void => cb(req)
    ipcRenderer.on('approval:request', listener)
    return () => ipcRenderer.off('approval:request', listener)
  },
  onApprovalCleared: (cb: (id: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('approval:cleared', listener)
    return () => ipcRenderer.off('approval:cleared', listener)
  },

  /** 세션 이벤트 구독. 반환값을 호출하면 구독 해제된다. */
  onSessionEvent: (cb: (envelope: SessionEventEnvelope) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, envelope: SessionEventEnvelope): void => cb(envelope)
    ipcRenderer.on('session:event', listener)
    return () => ipcRenderer.off('session:event', listener)
  },
}

export type WorkspaceApi = typeof api

contextBridge.exposeInMainWorld('api', api)
