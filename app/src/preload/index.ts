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
  RunningSession,
  SessionEvent,
  StoredEvent,
  StoredProject,
  StoredSession,
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

  listAgents: (projectPath: string): Promise<AgentDef[]> =>
    ipcRenderer.invoke('agent:list', projectPath),
  saveAgent: (agent: AgentDef): Promise<string> => ipcRenderer.invoke('agent:save', agent),
  routeInstruction: (instruction: string, runner: DetectedRunner, cwd: string): Promise<RouteResult> =>
    ipcRenderer.invoke('agent:route', instruction, runner, cwd),
  deleteAgent: (projectPath: string, name: string): Promise<void> =>
    ipcRenderer.invoke('agent:delete', projectPath, name),
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

  /** 세션 이벤트 구독. 반환값을 호출하면 구독 해제된다. */
  onSessionEvent: (cb: (envelope: SessionEventEnvelope) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, envelope: SessionEventEnvelope): void => cb(envelope)
    ipcRenderer.on('session:event', listener)
    return () => ipcRenderer.off('session:event', listener)
  },
}

export type WorkspaceApi = typeof api

contextBridge.exposeInMainWorld('api', api)
