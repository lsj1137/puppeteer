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

/** 세션이 정상 완료된 뒤 격리 worktree를 원본에 반영하는 방식. */
export type WorktreeIntegrationMode = 'off' | 'auto' | 'suggest'

export interface WorktreeIntegrationReport {
  mode: WorktreeIntegrationMode
  phase: 'checking' | 'committing' | 'merging' | 'completed' | 'skipped' | 'needs-review'
  summary: string
  detail?: string
  worktreePath: string
  updatedAt: number
  status?: Pick<
    WorktreeStatus,
    'dirty' | 'originDirty' | 'hasCommits' | 'ahead' | 'behind' | 'merged' | 'canMerge'
  >
}

// ---------------------------------------------------------------------------
// Agent Run — 한 세션 안의 개별 실행
// ---------------------------------------------------------------------------

/**
 * 세션 하나는 Lead run 하나로 시작하고, 멀티 Agent 위임이 붙으면 보조 run이 추가된다.
 * 세션 행을 늘리지 않는 이유는 사용자에게 대화가 하나로 보여야 하기 때문이다.
 * 여기서 말하는 Agent는 앱 라이브러리의 Puppeteer Agent(`AgentDef`)다.
 */
export type AgentRunRole = 'lead' | 'sub'

export interface AgentRun {
  id: string
  sessionId: string
  role: AgentRunRole
  /** 적용된 Puppeteer Agent 이름. 없으면 역할 정본 없이 도는 보조 run이다. */
  agentName?: string | null
  runnerId: string | null
  /** 보조 run에 위임된 지시. Lead run은 사용자 지시가 들어간다. */
  task: string
  status: SessionStatus
  costUsd: number
  startedAt: number
  endedAt?: number | null
}

/** 어댑터가 정규화해 올리는 이벤트. 모든 Provider가 이 타입으로 수렴한다. */
export type SessionEvent =
  | { t: 'run-start'; run: AgentRun }
  | { t: 'run-status'; runId: string; status: SessionStatus; reason?: string }
  | { t: 'run-result'; runId: string; ok: boolean; summary: string; costUsd?: number }
  | { t: 'status'; status: SessionStatus; reason?: string }
  | { t: 'session-meta'; meta: SessionMeta }
  | { t: 'message'; role: 'assistant' | 'user'; messageId: string; text: string; isError?: boolean }
  | { t: 'notice'; level: 'info' | 'warning' | 'error'; title: string; text: string }
  | { t: 'memory-proposal'; proposal: MemoryProposal }
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
  /** 요청한 run. 비어 있으면 Lead run이다(멀티 Agent 이전 기록 포함). */
  runId?: string
  /** 보조 run 이 요청한 경우 화면에 붙일 이름. Lead 요청에는 없다. */
  runLabel?: string
  /** 세션이 속한 원본 프로젝트. cwd는 격리 worktree일 수 있다. */
  projectPath?: string
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

export type RunnerKind = 'windows-native' | 'wsl' | 'posix' | 'custom'

export type InstallMethod = 'npm' | 'bun' | 'native' | 'unknown'

/** 세션에 지정할 수 있는 모델 하나. `value` 가 CLI 에 그대로 넘어간다. */
export interface ModelOption {
  value: string
  label: string
  detail?: string
}

/**
 * 실행 환경별 모델 후보. Codex 목록은 CLI 캐시에서 읽으므로 실패할 수 있고,
 * 그때는 후보를 지어내지 않고 `note` 로 이유를 남긴 채 직접 입력만 받는다.
 */
export interface ModelChoices {
  options: ModelOption[]
  /** 목록을 읽어온 파일 경로 */
  source?: string
  note?: string
}

/** 탐지된 실행 환경 1건 */
export interface DetectedRunner {
  id: string
  kind: RunnerKind
  provider: ProviderId
  /** wsl 인 경우 배포판 이름 */
  distro?: string
  executable: string
  /** 실행 파일 뒤, CLI 인자 앞에 붙일 고정 인자. custom/test runner가 사용한다. */
  executableArgs?: string[]
  /** 이 러너가 CLAUDE.md 를 읽는 홈. WSL 은 UNC 경로로 준다. */
  home?: string
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
  /** 사용자가 지정한 표시 이름. 비어 있으면 폴더명을 사용한다. */
  alias: string | null
  runnerId: string | null
  /** 이 프로젝트의 격리·자동 반영 정책. */
  worktreeMode?: WorktreeIntegrationMode
  addedAt: number
  lastUsedAt: number | null
  sortOrder?: number | null
}

export interface ProjectRelinkResult {
  ok: boolean
  canceled?: boolean
  message: string
  oldPath: string
  newPath?: string
  project?: StoredProject
}

export interface StoredSession {
  /** 격리 실행 중이면 그 정보 */
  worktree?: SessionWorktree | null
  /** 기존 worktree를 정리했으며, 다음 지시에서 새 worktree를 만들어야 하는지 */
  worktreeCleaned?: boolean
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
  sortOrder?: number | null
  hidden?: boolean
  approvalMode?: ApprovalMode
  /** 이 세션에 지정한 모델. 비어 있으면 Agent 지정값, 그것도 없으면 CLI 기본을 쓴다. */
  model?: string | null
}

export interface ProjectWorktreeModeResult {
  ok: boolean
  message: string
  project?: StoredProject
}

export type ApprovalMode = 'ask' | 'auto'

export interface StoredEvent {
  id: number
  createdAt: number
  /** 어느 run이 낸 이벤트인지. 비어 있으면 Lead run이다. */
  runId?: string
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

export interface ProjectFileEntry {
  path: string
  kind: 'file' | 'directory'
}

export interface ProjectFilePreview {
  path: string
  size: number
  content?: string
  reason?: 'binary' | 'too-large' | 'unreadable'
}

export interface GitHistoryEntry {
  hash: string
  shortHash: string
  subject: string
  author: string
  authoredAt: string
  refs: string[]
}

export interface ProjectStat {
  path: string
  alias: string | null
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
  /** 이 에이전트를 쓸 프로젝트 경로. 비어 있으면 전체 허용. */
  projects?: string[]
  /** 원본과 연결된 경우(Linked) 그 출처 */
  source?: AgentSource
  /** 이 에이전트에만 적용되는 메모리. 실행 시 지침 뒤에 붙는다. */
  memory?: string
  /**
   * 이 에이전트를 돌려도 되는 provider. 비우면 제한 없음.
   * 내부 도메인 지식이 든 에이전트를 외부 모델로 보내지 않기 위한 가드다.
   */
  providers?: ProviderId[]
  /** 이름별 Skill 사용 정책. 미지정은 Available이다. */
  skills?: Record<string, SkillState>
}

export type SkillScope = 'global' | 'project' | 'agent'
export type SkillState = 'required' | 'available' | 'disabled'

/** 공통 SKILL.md 정본 한 건. */
export interface SkillDef {
  id: string
  name: string
  description: string
  scope: SkillScope
  location: string
  content: string
  projectPath?: string
  agentName?: string
}

/** 외부 SKILL.md를 정본으로 저장하기 전 보여주는 무손실 검토 결과. */
export interface SkillImportPreview {
  sourcePath: string
  sourceFormat: 'codex-skill' | 'generic-skill'
  skill: Pick<SkillDef, 'name' | 'description' | 'content'>
  ignoredFrontmatter: string[]
}

export interface AgentSource {
  url: string
  /** 마지막으로 반영한 원본의 해시. 이게 달라지면 업데이트가 있는 것이다. */
  hash: string
  /** 마지막 확인 시각 (epoch ms) */
  checkedAt?: number
}

export interface AgentDef {
  name: string
  description: string
  /** 역할 지침 (파일 본문) */
  instructions: string
  model?: string
  tools?: string
  /** 저장 위치를 담은 파일 경로 */
  filePath: string
  /**
   * library = 앱이 전역으로 관리 (여기가 정본)
   * project = 프로젝트의 .claude/agents 에 있던 것 — 가져오기 후보로만 보여준다
   */
  scope: 'library' | 'project'
  /** scope === 'project' 일 때 원본이 있던 프로젝트 */
  projectPath?: string
  workspace: AgentWorkspaceConfig
}

/** 홈에서 지시를 받았을 때 고를 수 있는 에이전트 하나 */
export interface RouteCandidate {
  agentName: string
  description: string
  /** 이 에이전트를 쓸 수 있는 프로젝트. 적용 대상이 비면 등록된 전체가 들어온다. */
  projects: string[]
}

/** 라우팅 결과. pick 이 없으면 사용자가 직접 고른다. */
export interface RouteResult {
  candidates: RouteCandidate[]
  pick?: RouteCandidate
  reason: string
}

/** 가져온 에이전트 — 아직 저장되지 않았고, 사용자가 검토한 뒤에야 반영된다. */
export interface FetchedAgent {
  agent: AgentDef
  /** 어디서 왔는지 */
  source: string
  /** 원본 내용의 해시. Linked 로 둘 때 변경 감지 기준이 된다. */
  hash: string
  /** URL 로 가져온 경우에만 연결을 유지할 수 있다 */
  linkable: boolean
  /** 파일이 요구한 권한. 켜주지 않고 무엇을 요구했는지만 알린다. */
  requested: { allowedTools: string[]; disallowedTools: string[]; model?: string }
}

/** 연결된 원본을 확인한 결과 */
export interface UpdateCheck {
  name: string
  /** 확인 자체가 실패한 경우(네트워크·404 등) */
  error?: string
  changed: boolean
  /** changed 일 때만 채워진다 */
  fetched?: FetchedAgent
  /** 지금 저장된 지침 — 렌더러가 diff 를 그린다 */
  current?: string
}

export type MemoryScope = 'global' | 'project' | 'auto' | 'agent'

/** CLI 가 실제로 읽는 메모리 하나 */
export interface MemoryEntry {
  /** scope 와 대상을 합친 키 */
  id: string
  scope: MemoryScope
  /** 화면에 보여줄 이름 */
  label: string
  /** 어디에 적히는지 — 사용자에게 그대로 보여준다 */
  location: string
  /** 같은 묶음으로 보여줄 이름 (자동 메모리는 작업 경로) */
  group?: string
  /** 목록에서는 비어 있다. 고른 항목만 따로 읽어 채운다. */
  content: string
  exists: boolean
  /** 마지막 수정 시각 (epoch ms) */
  updatedAt?: number
  /** 이 항목에 대해 짚어줄 것 (예: 다른 도구가 못 읽는 위치) */
  note?: string
  /** 어떤 CLI 가 읽는지 */
  readBy: 'both' | 'claude'
}

/** Memory 변경 이력 한 건 */
export interface MemoryEdit {
  id: number
  entryId: string
  bytes: number
  at: number
}

export type MemoryProposalStatus = 'pending' | 'approved' | 'rejected'

/** AI가 제안했지만 아직 정본에는 반영되지 않은 Memory 추가안. */
export interface MemoryProposal {
  id: number
  sessionId: string
  entryId: string
  scope: Extract<MemoryScope, 'project' | 'agent'>
  content: string
  reason: string
  status: MemoryProposalStatus
  createdAt: number
  decidedAt?: number
}

/** 세션 전용 worktree */
export interface SessionWorktree {
  /** worktree 실제 경로 (세션의 cwd 가 된다) */
  path: string
  branch: string
  /** worktree 를 만든 원래 프로젝트 경로 */
  origin: string
  /** 생성 당시 원래 프로젝트에서 체크아웃되어 있던 브랜치 */
  baseBranch?: string
  /** worktree 가 갈라진 전체 커밋 해시 */
  baseHead?: string
}

/** worktree 브랜치를 원래 프로젝트로 합칠 수 있는지 확인한 결과 */
export interface WorktreeStatus {
  worktree: SessionWorktree
  currentBranch?: string
  baseBranch?: string
  dirty: boolean
  originDirty: boolean
  /** 생성 기준 커밋 이후 worktree 브랜치가 실제 커밋을 만든 적이 있는지 */
  hasCommits: boolean
  ahead: number
  behind: number
  merged: boolean
  canMerge: boolean
  /** 중단된 rebase에서 아직 해결해야 하는 파일 */
  conflictFiles?: string[]
  reason?: string
  /** 마지막 자동 반영 시도. Git 상태와 별도로 저장해 실패 원인을 다시 볼 수 있다. */
  integration?: WorktreeIntegrationReport
}

/** fast-forward 병합 시도 결과 */
export interface WorktreeMergeResult {
  ok: boolean
  message: string
  status?: WorktreeStatus
}

/** worktree 폴더와 안전하게 삭제 가능한 작업 브랜치의 정리 결과 */
export interface WorktreeCleanupResult {
  ok: boolean
  message: string
  /** 작업 브랜치까지 삭제했는지. 미병합 브랜치는 보존한다. */
  branchRemoved?: boolean
}

/** worktree 안의 미커밋 변경을 작업 브랜치에 커밋한 결과 */
export interface WorktreeCommitResult {
  ok: boolean
  message: string
  status?: WorktreeStatus
}

/** 원본 브랜치의 새 커밋 위로 worktree 브랜치를 재배치한 결과 */
export interface WorktreeRebaseResult {
  ok: boolean
  message: string
  conflictFiles?: string[]
  status?: WorktreeStatus
}

export type WorktreeRebaseStrategy = 'origin' | 'worktree'

export interface WorktreeConflictFile {
  path: string
  originLabel: string
  worktreeLabel: string
  originContent: string
  worktreeContent: string
  originMissing: boolean
  worktreeMissing: boolean
  /** 텍스트 병합 대신 파일 전체를 한쪽에서 골라야 하는 파일 */
  binary: boolean
  language?: string
}

export interface WorktreeConflictResolverRequest {
  token: string
  sessionId: string
  files: string[]
}

export interface WorktreeResolvedFile {
  path: string
  /** 직접 조합한 텍스트. 전체 선택이나 삭제일 때는 생략한다. */
  content?: string
  /** 바이너리 등 파일 전체를 선택할 때 사용한다. */
  side?: WorktreeRebaseStrategy
  /** 선택한 쪽에 파일이 없어서 삭제해야 할 때 사용한다. */
  deleted?: boolean
}

export interface SessionDeleteResult {
  ok: boolean
  message?: string
}

/** Checkpoint 초안 — 세션을 넘길 때 쓸 텍스트 */
export interface CheckpointDraft {
  sessionId: string
  title: string
  projectPath: string
  /** 편집 가능한 본문 (마크다운) */
  body: string
}
