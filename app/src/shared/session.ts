// 세션 도메인 타입.
// Claude Code CLI 2.1.220 stream-json 실측 기준 (spike/REPORT.md).

export type SessionStatus =
  | 'starting'
  | 'running'
  | 'waiting-input'
  | 'approval-required'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'disconnected'
  | 'auth-required'

export type RiskLevel = 'low' | 'med' | 'high'

export type ArtifactKind = 'code' | 'md' | 'diff' | 'image' | 'log'

/** 어댑터가 정규화해 올리는 이벤트. 모든 Provider가 이 타입으로 수렴한다. */
export type SessionEvent =
  | { t: 'status'; status: SessionStatus; reason?: string }
  | { t: 'session-meta'; meta: SessionMeta }
  | { t: 'message'; role: 'assistant' | 'user'; messageId: string; text: string; isError?: boolean }
  | { t: 'tool-use'; toolUseId: string; name: string; input: unknown }
  | { t: 'tool-result'; toolUseId: string; ok: boolean; preview: string }
  | { t: 'artifact'; kind: ArtifactKind; path?: string; language?: string; content: string }
  | { t: 'approval'; id: string; tool: string; input: unknown; cwd: string; risk: RiskLevel }
  | { t: 'file-changed'; path: string }
  | { t: 'conflict'; path: string; otherSessionId: string; otherTitle: string }
  | { t: 'snapshot'; snapshot: GitSnapshot }
  | { t: 'usage'; usage: UsageSnapshot }
  | { t: 'rate-limit'; info: RateLimitInfo }

/** system/init 이벤트에서 추출 */
export interface SessionMeta {
  /** CLI 실제 세션 ID — Resume 에 사용 */
  cliSessionId: string
  cwd: string
  model: string
  permissionMode: string
  cliVersion: string
  /** 'none' 이면 미인증 가능성 */
  apiKeySource: string
  tools: string[]
  /** CLI 가 알려주는 메모리 경로 — 앱이 추측하지 않는다 */
  memoryPaths?: Record<string, string>
}

/** result 이벤트에서 추출. 비용은 CLI 가 계산해준다. */
export interface UsageSnapshot {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** CLI 제공값 — 자체 계산하지 않는다 */
  totalCostUsd: number
  /** 모델별 분해 */
  byModel?: Record<string, { inputTokens: number; outputTokens: number; costUSD: number }>
}

export interface RateLimitInfo {
  status: string
  rateLimitType: string
  /** epoch seconds */
  resetsAt: number
}

// ---------------------------------------------------------------------------
// 승인
// ---------------------------------------------------------------------------

export type ApprovalDecision = 'allow-once' | 'allow-session' | 'deny'

export interface ApprovalRequest {
  /** 앱 내부 승인 ID */
  id: string
  sessionId: string
  tool: string
  input: unknown
  cwd: string
  risk: RiskLevel
  /** hook 이 대기 한도를 넘겨 보류로 넘어간 요청 */
  pending: boolean
}

/** result.permission_denials[] 대응 */
export interface PermissionDenial {
  toolName: string
  toolUseId: string
  toolInput: unknown
}

// ---------------------------------------------------------------------------
// 실행 환경
// ---------------------------------------------------------------------------

export type ProviderId = 'claude-cli' | 'claude-agent-sdk' | 'codex-cli'

export type RunnerKind = 'windows-native' | 'wsl' | 'custom'

export type InstallMethod = 'npm' | 'bun' | 'native' | 'unknown'

/** 탐지된 실행 환경 1건 */
export interface DetectedRunner {
  id: string
  kind: RunnerKind
  provider: ProviderId
  /** wsl 인 경우 배포판 이름 */
  distro?: string
  executable: string
  version?: string
  installMethod: InstallMethod
  available: boolean
  note?: string
}

// ---------------------------------------------------------------------------
// 영속화 (SQLite)
// ---------------------------------------------------------------------------

export interface StoredProject {
  path: string
  runnerId: string | null
  addedAt: number
  lastUsedAt: number | null
}

export interface StoredSession {
  id: string
  projectPath: string
  cliSessionId: string | null
  runnerId: string | null
  title: string | null
  agentName?: string | null
  status: SessionStatus
  costUsd: number
  startedAt: number
  endedAt: number | null
}

export interface StoredEvent {
  id: number
  createdAt: number
  event: SessionEvent
}

export interface RunningSession {
  id: string
  projectPath: string
  title: string
  status: SessionStatus
}

/** 세션 시작 시점의 git 상태 */
export interface GitSnapshot {
  branch: string
  head: string
  modified: string[]
  untracked: string[]
  takenAt: number
}

export interface ChangedFile {
  path: string
  status: string
}

export interface ProjectStat {
  path: string
  runnerId: string | null
  lastUsedAt: number | null
  sessionCount: number
  totalCostUsd: number
  lastSessionAt: number | null
}

export interface CostTotals {
  today: number
  month: number
  all: number
}

// ---------------------------------------------------------------------------
// Project Agent
// ---------------------------------------------------------------------------

/** 앱 전용 확장 설정. Claude Code 표준 필드와 섞이지 않게 x-workspace 아래에 둔다. */
export interface AgentWorkspaceConfig {
  readPaths?: string[]
  writePaths?: string[]
  allowedTools?: string[]
  disallowedTools?: string[]
  completion?: string
  worktree?: string
}

export interface AgentDef {
  name: string
  description: string
  /** 역할 지침 (파일 본문) */
  instructions: string
  model?: string
  tools?: string
  projectPath: string
  filePath: string
  workspace: AgentWorkspaceConfig
}

/** 홈에서 지시를 받았을 때 고를 수 있는 에이전트 하나 */
export interface RouteCandidate {
  projectPath: string
  projectName: string
  agentName: string
  description: string
}

/** 라우팅 결과. pick 이 없으면 사용자가 직접 고른다. */
export interface RouteResult {
  candidates: RouteCandidate[]
  pick?: RouteCandidate
  reason: string
}
