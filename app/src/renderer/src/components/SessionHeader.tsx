import type { RefObject } from 'react'
import {
  Bot,
  ChevronDown,
  Flag,
  GitBranch,
  Loader2,
  Lock,
  MessageSquarePlus,
  Monitor,
  Pencil,
  Plus,
  ShieldAlert,
  Terminal,
  X,
} from 'lucide-react'
import type { AgentDef, ApprovalRequest, DetectedRunner, RunningSession, StoredSession } from '@shared/session'
import { runnerEnvironmentLabel } from '@shared/runner'

const PROVIDER_LABEL: Record<string, string> = {
  'claude-cli': 'Claude',
  'codex-cli': 'Codex',
  'claude-agent-sdk': 'Claude (SDK)',
}

const runnerLabel = (runner: DetectedRunner): string =>
  runnerEnvironmentLabel(runner) + (runner.version ? ` · ${runner.version}` : '')

const RunnerIcon = ({ runner, className }: { runner: DetectedRunner; className?: string }) =>
  runner.kind === 'wsl' ? <Terminal className={className} /> : <Monitor className={className} />

interface SessionHeaderProps {
  tabBarRef: RefObject<HTMLDivElement | null>
  activeSessionId?: string
  visibleTabs: StoredSession[]
  overflowTabs: StoredSession[]
  running: RunningSession[]
  approvals: ApprovalRequest[]
  tabMenuOpen: boolean
  onToggleTabMenu: () => void
  onCloseTabMenu: () => void
  onNewSession: () => void
  onOpenSession: (sessionId: string) => void
  onDeleteSession: (session: StoredSession) => void
  selectedSession?: StoredSession
  onOpenWorktree: (sessionId: string) => void
  onCheckpoint: (sessionId: string) => void
}

/** 프로젝트 화면 상단의 세션 탭과 세션별 실행 설정. */
export default function SessionHeader({
  tabBarRef,
  activeSessionId,
  visibleTabs,
  overflowTabs,
  running,
  approvals,
  tabMenuOpen,
  onToggleTabMenu,
  onCloseTabMenu,
  onNewSession,
  onOpenSession,
  onDeleteSession,
  selectedSession,
  onOpenWorktree,
  onCheckpoint,
}: SessionHeaderProps) {
  const worktree = selectedSession?.worktree
  const worktreeCleaned = Boolean(selectedSession?.worktreeCleaned && !worktree)

  return (
    <div className="col-start-2 col-end-4 row-start-1 z-20 flex items-end bg-mantle pl-2 pr-2 pt-1">
      <div ref={tabBarRef} className="flex min-w-0 flex-1 items-end gap-0.5">
        <button
          onClick={onNewSession}
          title="새 세션"
          className={`flex shrink-0 items-center gap-1 rounded-t-lg px-2.5 py-1.5 text-[13px] ${
            activeSessionId === undefined ? 'bg-base text-text' : 'text-subtext0 hover:bg-surface0/60'
          }`}
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>

        {visibleTabs.map((session) => {
          const active = session.id === activeSessionId
          const live = running.some((item) => item.id === session.id)
          const waiting = approvals.some((approval) => approval.sessionId === session.id)
          return (
            <div
              key={session.id}
              onClick={() => onOpenSession(session.id)}
              title={session.title ?? ''}
              className={`group flex min-w-0 max-w-[220px] flex-1 cursor-pointer items-center gap-1.5 rounded-t-lg py-1.5 pl-3 pr-1.5 text-[13px] ${
                active ? 'bg-base text-text' : 'text-subtext0 hover:bg-surface0/60'
              }`}
            >
              {live ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-green" />
              ) : waiting ? (
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-peach" />
              ) : (
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(session)}`} />
              )}
              <span className="flex-1 truncate">{session.title || '새 세션'}</span>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  onDeleteSession(session)
                }}
                title="세션 삭제"
                className={`rounded p-0.5 text-overlay1 hover:bg-red/20 hover:text-red ${
                  active ? '' : 'invisible group-hover:visible'
                }`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}

        {overflowTabs.length > 0 && (
          <div className="relative shrink-0">
            <button
              onClick={onToggleTabMenu}
              title={`세션 ${overflowTabs.length}개 더`}
              className="flex items-center gap-1 rounded-t-lg px-2 py-1.5 text-[12px] text-subtext0 hover:bg-surface0/60 hover:text-text"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              {overflowTabs.length}
            </button>
            {tabMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={onCloseTabMenu} />
                <div className="absolute left-0 top-full z-40 mt-1 max-h-80 w-72 overflow-auto rounded-lg border border-surface1 bg-mantle py-1 shadow-lg">
                  {overflowTabs.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => {
                        onCloseTabMenu()
                        onOpenSession(session.id)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(session)}`} />
                      <span className="truncate">{session.title || '새 세션'}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mb-1 flex shrink-0 items-center gap-1.5 pl-2">
        {worktree && selectedSession && (
          <button
            onClick={() => onOpenWorktree(selectedSession.id)}
            title={`격리 실행 중\n브랜치 ${worktree.branch}\n${worktree.path}`}
            className="flex min-w-0 max-w-[220px] items-center gap-1.5 rounded-md bg-teal/15 px-2 py-1 text-[11px] text-teal hover:bg-teal/25"
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{worktree.branch}</span>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </button>
        )}

        {worktreeCleaned && (
          <span
            title="기존 worktree가 정리되었습니다. 이 세션에 다시 지시하면 현재 원본 기준으로 새 worktree를 자동 생성합니다."
            className="flex min-w-0 max-w-[180px] items-center gap-1.5 rounded-md bg-surface0 px-2 py-1 text-[11px] text-subtext0"
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Worktree 정리됨</span>
          </span>
        )}

        {selectedSession && (
          <button
            onClick={() => onCheckpoint(selectedSession.id)}
            title="이 세션의 작업 상태를 정리해 다른 세션으로 넘깁니다"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-subtext0 hover:bg-surface0 hover:text-text"
          >
            <Flag className="h-3.5 w-3.5 text-teal" /> 체크포인트
          </button>
        )}

      </div>
    </div>
  )
}

function statusColor(session: StoredSession): string {
  if (session.status === 'failed') return 'bg-red'
  if (session.status === 'completed') return 'bg-surface2'
  return 'bg-yellow'
}

export function ComposerSettings({
  activeRunner,
  runnerLocked,
  onChooseRunner,
  ...agentProps
}: {
  activeRunner?: DetectedRunner
  runnerLocked: boolean
  onChooseRunner: () => void
  agentName?: string
  agents: AgentDef[]
  open: boolean
  onToggle: () => void
  onClose: () => void
  onSelect: (name?: string) => void
  onEdit: (agent: AgentDef) => void
  onNew: () => void
}) {
  return (
    <div className="mb-2 flex min-h-7 min-w-0 items-center gap-1.5 overflow-visible">
      {activeRunner ? (
        <button
          disabled={runnerLocked}
          onClick={() => !runnerLocked && onChooseRunner()}
          title={runnerLocked
            ? `이 세션은 ${runnerLabel(activeRunner)} 로 시작했습니다. 바꾸려면 새 세션을 여세요.`
            : `실행 환경 변경 · ${activeRunner.executable}`}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
            activeRunner.provider === 'claude-cli' ? 'bg-surface0/60 text-subtext1' : 'bg-peach/15 text-peach'
          } ${runnerLocked ? 'cursor-default' : 'hover:bg-surface0 hover:text-text'}`}
        >
          <RunnerIcon runner={activeRunner} className="h-3.5 w-3.5" />
          {PROVIDER_LABEL[activeRunner.provider] ?? activeRunner.provider}
          {runnerLocked && <Lock className="h-3 w-3 text-overlay1" />}
        </button>
      ) : (
        <button
          onClick={onChooseRunner}
          className="rounded-md border border-dashed border-surface1 px-2 py-1 text-[11px] text-overlay1 hover:border-overlay0 hover:text-text"
        >
          실행 환경 선택
        </button>
      )}
      <AgentPicker {...agentProps} />
    </div>
  )
}

function AgentPicker({
  agentName,
  agents,
  open,
  onToggle,
  onClose,
  onSelect,
  onEdit,
  onNew,
}: {
  agentName?: string
  agents: AgentDef[]
  open: boolean
  onToggle: () => void
  onClose: () => void
  onSelect: (name?: string) => void
  onEdit: (agent: AgentDef) => void
  onNew: () => void
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        title="Project Agent 선택"
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
          agentName
            ? 'bg-mauve/20 text-mauve'
            : 'bg-surface0/60 text-subtext1 hover:bg-surface0 hover:text-text'
        }`}
      >
        <Bot className="h-3.5 w-3.5" />
        {agentName ?? '에이전트 없음'}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onClose} />
          <div className="absolute bottom-full left-0 z-40 mb-1 w-72 overflow-hidden rounded-lg border border-surface1 bg-mantle shadow-xl">
            <button
              onClick={() => onSelect(undefined)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] ${
                agentName ? 'text-subtext1 hover:bg-surface0' : 'bg-surface0 text-text'
              }`}
            >
              에이전트 없이 실행
            </button>
            {agents.map((agent) => (
              <div
                key={agent.name}
                className={`group flex items-center gap-1 ${
                  agent.name === agentName ? 'bg-surface0' : 'hover:bg-surface0/60'
                }`}
              >
                <button onClick={() => onSelect(agent.name)} className="min-w-0 flex-1 px-3 py-2 text-left">
                  <div className="flex items-center gap-1.5 text-[12px] text-text">
                    <Bot className="h-3.5 w-3.5 shrink-0 text-mauve" /> {agent.name}
                  </div>
                  {agent.description && (
                    <div className="truncate text-[11px] text-overlay1">{agent.description}</div>
                  )}
                </button>
                <button
                  onClick={() => onEdit(agent)}
                  title="편집"
                  className="mr-2 hidden rounded p-1 text-overlay1 hover:text-text group-hover:block"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={onNew}
              className="flex w-full items-center gap-1.5 border-t border-surface0 px-3 py-2 text-left text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
            >
              <Plus className="h-3.5 w-3.5" /> 새 에이전트
            </button>
          </div>
        </>
      )}
    </div>
  )
}
