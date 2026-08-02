import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AgentDef,
  ApprovalDecision,
  ApprovalRequest,
  ChangedFile,
  CostTotals,
  ProjectStat,
  DetectedRunner,
  RouteResult,
  FetchedAgent,
  UpdateCheck,
  MemoryEntry,
  MemoryEdit,
  CheckpointDraft,
  RunningSession,
  SessionEvent,
  StoredEvent,
  StoredProject,
  StoredSession,
  WorktreeMergeResult,
  WorktreeStatus,
} from '@shared/session'

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
  detectRunners: (): Promise<DetectedRunner[]> => ipcRenderer.invoke('runner:detect'),

  pickProject: (): Promise<string | undefined> => ipcRenderer.invoke('project:pick'),

  listProjects: (): Promise<StoredProject[]> => ipcRenderer.invoke('project:list'),
  removeProject: (path: string): Promise<void> => ipcRenderer.invoke('project:remove', path),
  setProjectRunner: (path: string, runnerId: string): Promise<void> =>
    ipcRenderer.invoke('project:setRunner', path, runnerId),

  listSessions: (projectPath: string): Promise<StoredSession[]> =>
    ipcRenderer.invoke('session:list', projectPath),
  getSession: (sessionId: string): Promise<StoredSession | undefined> =>
    ipcRenderer.invoke('session:get', sessionId),
  listEvents: (sessionId: string): Promise<StoredEvent[]> =>
    ipcRenderer.invoke('session:events', sessionId),
  listOpenApprovals: (): Promise<ApprovalRequest[]> => ipcRenderer.invoke('approval:open'),
  listRunningSessions: (): Promise<RunningSession[]> => ipcRenderer.invoke('session:running'),
  costTotals: (): Promise<CostTotals> => ipcRenderer.invoke('cost:totals'),
  setNotifyEnabled: (v: boolean): Promise<void> => ipcRenderer.invoke('notify:setEnabled', v),
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
  exportAgent: (name: string, projectPath: string): Promise<string | undefined> =>
    ipcRenderer.invoke('agent:export', name, projectPath),
  fetchAgentFromUrl: (url: string): Promise<FetchedAgent> =>
    ipcRenderer.invoke('agent:fetchUrl', url),
  fetchAgentFromFile: (): Promise<FetchedAgent | undefined> => ipcRenderer.invoke('agent:fetchFile'),
  checkAgentUpdate: (name: string): Promise<UpdateCheck> =>
    ipcRenderer.invoke('agent:checkUpdate', name),
  applyAgentUpdate: (
    name: string,
    opts: { tools?: string[]; model?: string | null },
  ): Promise<AgentDef | undefined> => ipcRenderer.invoke('agent:applyUpdate', name, opts),
  dropWorktree: (sessionId: string, force: boolean): Promise<boolean> =>
    ipcRenderer.invoke('session:dropWorktree', sessionId, force),
  worktreeStatus: (sessionId: string): Promise<WorktreeStatus | undefined> =>
    ipcRenderer.invoke('session:worktreeStatus', sessionId),
  worktreeDiff: (sessionId: string): Promise<string> =>
    ipcRenderer.invoke('session:worktreeDiff', sessionId),
  mergeWorktree: (sessionId: string): Promise<WorktreeMergeResult> =>
    ipcRenderer.invoke('session:mergeWorktree', sessionId),
  buildCheckpoint: (sessionId: string): Promise<CheckpointDraft | undefined> =>
    ipcRenderer.invoke('checkpoint:build', sessionId),
  listMemories: (): Promise<MemoryEntry[]> => ipcRenderer.invoke('memory:list'),
  readMemory: (id: string): Promise<string> => ipcRenderer.invoke('memory:read', id),
  saveMemory: (id: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('memory:save', id, content),
  memoryHistory: (entryId?: string): Promise<MemoryEdit[]> =>
    ipcRenderer.invoke('memory:history', entryId),
  routeInstruction: (instruction: string, runner: DetectedRunner, cwd: string): Promise<RouteResult> =>
    ipcRenderer.invoke('agent:route', instruction, runner, cwd),
  overviewStats: (): Promise<{
    projects: ProjectStat[]
    recent: StoredSession[]
    cost: CostTotals
  }> => ipcRenderer.invoke('overview:stats'),
  revealProject: (path: string): Promise<string> => ipcRenderer.invoke('project:reveal', path),
  listChanges: (sessionId: string): Promise<ChangedFile[]> =>
    ipcRenderer.invoke('session:changes', sessionId),
  fileDiff: (sessionId: string, path: string): Promise<string> =>
    ipcRenderer.invoke('session:diff', sessionId, path),
  saveAttachment: (projectPath: string, fileName: string, dataBase64: string): Promise<string> =>
    ipcRenderer.invoke('attachment:save', projectPath, fileName, dataBase64),

  startSession: (args: StartSessionArgs): Promise<string> =>
    ipcRenderer.invoke('session:start', args),

  stopSession: (id: string): Promise<void> => ipcRenderer.invoke('session:stop', id),
  deleteSession: (id: string): Promise<void> => ipcRenderer.invoke('session:delete', id),

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
