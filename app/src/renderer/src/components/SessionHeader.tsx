import { useEffect, useState, type RefObject } from 'react'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Flag,
  GitBranch,
  GitCommitHorizontal,
  Eye,
  EyeOff,
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

const providerBadgeClass = (provider: string): string =>
  provider === 'codex-cli'
    ? 'bg-green/15 text-green'
    : 'bg-mauve/15 text-mauve'

const RunnerIcon = ({ runner, className }: { runner: DetectedRunner; className?: string }) =>
  runner.kind === 'wsl' ? <Terminal className={className} /> : <Monitor className={className} />

interface SessionHeaderProps {
  tabBarRef: RefObject<HTMLDivElement | null>
  activeSessionId?: string
  visibleTabs: StoredSession[]
  overflowTabs: StoredSession[]
  allSessions: StoredSession[]
  hiddenSessions: StoredSession[]
  running: RunningSession[]
  approvals: ApprovalRequest[]
  tabMenuOpen: boolean
  onToggleTabMenu: () => void
  onCloseTabMenu: () => void
  onNewSession: () => void
  onOpenSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, title: string) => void | Promise<void>
  onReorderSessions: (ids: string[]) => void | Promise<void>
  onHideSession: (session: StoredSession) => void | Promise<void>
  onRestoreSession: (session: StoredSession) => void | Promise<void>
  onDeleteSession: (session: StoredSession) => void
  selectedSession?: StoredSession
  onOpenWorktree: (sessionId: string) => void
  onCheckpoint: (sessionId: string) => void
}
const PROVIDER_ORDER = ['claude-cli', 'codex-cli', 'claude-agent-sdk']

/** 프로젝트 화면 상단의 세션 탭과 세션별 실행 설정. */
export default function SessionHeader({
  tabBarRef,
  activeSessionId,
  visibleTabs,
  overflowTabs,
  allSessions,
  hiddenSessions,
  running,
  approvals,
  tabMenuOpen,
  onToggleTabMenu,
  onCloseTabMenu,
  onNewSession,
  onOpenSession,
  onRenameSession,
  onReorderSessions,
  onHideSession,
  onRestoreSession,
  onDeleteSession,
  selectedSession,
  onOpenWorktree,
  onCheckpoint,
}: SessionHeaderProps) {
  const worktree = selectedSession?.worktree
  const worktreeCleaned = Boolean(selectedSession?.worktreeCleaned && !worktree)
  const [editingSessionId, setEditingSessionId] = useState<string>()
  const [sessionTitleDraft, setSessionTitleDraft] = useState('')
  const [draggingSessionId, setDraggingSessionId] = useState<string>()
  const [dropSessionId, setDropSessionId] = useState<string>()

  const beginRename = (session: StoredSession): void => {
    setEditingSessionId(session.id)
    setSessionTitleDraft(session.title || '새 세션')
  }
  const finishRename = (session: StoredSession): void => {
    const title = sessionTitleDraft.trim()
    setEditingSessionId(undefined)
    if (title && title !== session.title) void onRenameSession(session.id, title)
  }

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
              draggable={editingSessionId !== session.id}
              onDragStart={(event) => {
                setDraggingSessionId(session.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', session.id)
              }}
              onDragOver={(event) => {
                if (!draggingSessionId || draggingSessionId === session.id) return
                event.preventDefault()
                setDropSessionId(session.id)
              }}
              onDrop={(event) => {
                event.preventDefault()
                const source = draggingSessionId ?? event.dataTransfer.getData('text/plain')
                const ids = allSessions.map(({ id }) => id)
                const from = ids.indexOf(source)
                const to = ids.indexOf(session.id)
                if (from >= 0 && to >= 0 && from !== to) {
                  const [moved] = ids.splice(from, 1)
                  if (moved) ids.splice(to, 0, moved)
                  void onReorderSessions(ids)
                }
                setDraggingSessionId(undefined)
                setDropSessionId(undefined)
              }}
              onDragEnd={() => {
                setDraggingSessionId(undefined)
                setDropSessionId(undefined)
              }}
              onClick={() => onOpenSession(session.id)}
              onDoubleClick={(event) => {
                event.stopPropagation()
                beginRename(session)
              }}
              title={session.title ?? ''}
              className={`group flex min-w-0 max-w-[220px] flex-1 cursor-pointer items-center gap-1.5 rounded-t-lg py-1.5 pl-3 pr-1.5 text-[13px] ${
                dropSessionId === session.id ? 'ring-1 ring-inset ring-sapphire/70' : ''
              } ${draggingSessionId === session.id ? 'opacity-50' : ''} ${
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
              {editingSessionId === session.id ? (
                <input
                  autoFocus
                  value={sessionTitleDraft}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setSessionTitleDraft(event.target.value)}
                  onBlur={() => finishRename(session)}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter') finishRename(session)
                    if (event.key === 'Escape') setEditingSessionId(undefined)
                  }}
                  className="min-w-0 flex-1 rounded bg-crust/70 px-1.5 py-0.5 text-[12px] text-text outline-none ring-1 ring-sapphire/60"
                />
              ) : (
                <span className="flex-1 truncate">{session.title || '새 세션'}</span>
              )}
              {editingSessionId !== session.id && (
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    beginRename(session)
                  }}
                  title="세션 이름 변경"
                  className={`rounded p-0.5 text-overlay1 hover:bg-surface0 hover:text-text ${
                    active ? '' : 'invisible group-hover:visible'
                  }`}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
              {!live && !waiting && (
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    void onHideSession(session)
                  }}
                  title="세션 숨기기"
                  className={`rounded p-0.5 text-overlay1 hover:bg-surface0 hover:text-subtext1 ${
                    active ? '' : 'invisible group-hover:visible'
                  }`}
                >
                  <EyeOff className="h-3 w-3" />
                </button>
              )}
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

        {(overflowTabs.length > 0 || hiddenSessions.length > 0) && (
          <div className="relative shrink-0">
            <button
              onClick={onToggleTabMenu}
              title={`다른 세션 ${overflowTabs.length + hiddenSessions.length}개`}
              className="flex items-center gap-1 rounded-t-lg px-2 py-1.5 text-[12px] text-subtext0 hover:bg-surface0/60 hover:text-text"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              {overflowTabs.length + hiddenSessions.length}
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
                  {hiddenSessions.length > 0 && (
                    <div className="mt-1 border-t border-surface0 pt-1">
                      <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-overlay1">
                        숨긴 세션
                      </div>
                      {hiddenSessions.map((session) => (
                        <button
                          key={session.id}
                          onClick={() => void onRestoreSession(session)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-subtext0 hover:bg-surface0 hover:text-text"
                        >
                          <Eye className="h-3.5 w-3.5 shrink-0" />
                          <span className="flex-1 truncate">{session.title || '새 세션'}</span>
                          <span className="text-[10px] text-overlay1">복원</span>
                        </button>
                      ))}
                    </div>
                  )}
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
  runners,
  commitNotice,
  agentName,
  agents,
  forceRunnerOpen,
  onChooseRunner,
  onSelect,
  onEdit,
  onNew,
}: {
  activeRunner?: DetectedRunner
  runnerLocked: boolean
  runners: DetectedRunner[]
  commitNotice?: { id: string; title: string; text: string; status: 'success' | 'warning' }
  onChooseRunner: (runnerId: string) => void | Promise<void>
  agentName?: string
  agents: AgentDef[]
  forceRunnerOpen: boolean
  onSelect: (name?: string) => void
  onEdit: (agent: AgentDef) => void
  onNew: () => void
}) {
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem('ws.composerContextExpanded') !== 'false',
  )
  const [panel, setPanel] = useState<'runner' | 'agent' | 'commit'>()
  const [commitExpanded, setCommitExpanded] = useState(false)

  useEffect(() => {
    if (!forceRunnerOpen) return
    setExpanded(true)
    setPanel('runner')
  }, [forceRunnerOpen])

  useEffect(() => {
    if (!commitNotice) return setCommitExpanded(false)
    const key = `workspace:context-notice-seen:${commitNotice.id}`
    const unseen = localStorage.getItem(key) !== '1'
    setCommitExpanded(unseen)
    localStorage.setItem(key, '1')
  }, [commitNotice?.id])

  useEffect(() => {
    const collapse = (): void => setCommitExpanded(false)
    window.addEventListener('workspace:user-interaction', collapse)
    return () => window.removeEventListener('workspace:user-interaction', collapse)
  }, [])

  const toggleExpanded = (): void => {
    setExpanded((current) => {
      const next = !current
      localStorage.setItem('ws.composerContextExpanded', String(next))
      if (!next) setPanel(undefined)
      return next
    })
  }

  const togglePanel = (next: 'runner' | 'agent' | 'commit'): void => {
    setPanel((current) => current === next ? undefined : next)
    if (next === 'commit') setCommitExpanded(false)
  }

  return (
    <div className={`relative min-w-0 transition-[margin] duration-150 ${expanded ? 'mb-1.5' : 'mb-0'}`}>
      <div
        className={`grid min-w-0 transition-[grid-template-rows,opacity,transform] duration-150 ease-out motion-reduce:transition-none ${
          expanded
            ? 'grid-rows-[1fr] translate-y-0 opacity-100'
            : 'pointer-events-none grid-rows-[0fr] translate-y-1 opacity-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => togglePanel('runner')}
            className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
              panel === 'runner' ? 'bg-surface0 text-text' : 'text-subtext0 hover:bg-surface0/60'
            }`}
          >
            {activeRunner
              ? <RunnerIcon runner={activeRunner} className="h-3.5 w-3.5 shrink-0 text-sapphire" />
              : <Monitor className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{activeRunner ? (PROVIDER_LABEL[activeRunner.provider] ?? activeRunner.provider) : '실행환경'}</span>
            {runnerLocked && <Lock className="h-3 w-3 shrink-0 text-overlay1" />}
          </button>
          <button
            type="button"
            onClick={() => togglePanel('agent')}
            className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
              panel === 'agent' ? 'bg-surface0 text-text' : 'text-subtext0 hover:bg-surface0/60'
            }`}
          >
            <Bot className="h-3.5 w-3.5 shrink-0 text-mauve" />
            <span className="truncate">{agentName ?? '에이전트 없음'}</span>
          </button>

        <button
          type="button"
          onClick={() => togglePanel('commit')}
          title={commitNotice?.title ?? '최근 자동 반영 내역'}
          className={`ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
            commitNotice?.status === 'success'
              ? 'text-green hover:bg-green/10'
              : commitNotice?.status === 'warning'
                ? 'text-yellow hover:bg-yellow/10'
                : 'text-overlay1 hover:bg-surface0/60 hover:text-subtext1'
          }`}
        >
          {commitNotice?.status === 'success'
            ? <CheckCircle2 className="h-4 w-4" />
            : commitNotice?.status === 'warning'
              ? <ShieldAlert className="h-4 w-4" />
              : <GitCommitHorizontal className="h-4 w-4" />}
          <span>반영 상태</span>
        </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={toggleExpanded}
        title={expanded ? '세션 도구 모음 접기' : '세션 도구 모음 펼치기'}
        className="absolute -top-4 left-1/2 z-10 flex h-4 w-12 -translate-x-1/2 items-center justify-center rounded-t-md bg-mantle text-overlay1 transition-colors hover:text-text"
      >
        {expanded
          ? <ChevronDown className="h-3 w-3" />
          : <ChevronUp className="h-3 w-3" />}
      </button>

      {commitNotice && commitExpanded && panel !== 'commit' && (
        <button
          type="button"
          onClick={() => setCommitExpanded(false)}
          className={`absolute bottom-full right-0 z-40 mb-1.5 flex w-[min(28rem,calc(100vw-2rem))] gap-2 rounded-xl border bg-mantle p-3 text-left shadow-xl ${
            commitNotice.status === 'success' ? 'border-green/40' : 'border-yellow/40'
          }`}
        >
          {commitNotice.status === 'success'
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green" />
            : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-yellow" />}
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-text">{commitNotice.title}</span>
            <span className="mt-0.5 block whitespace-pre-wrap text-[11px] leading-relaxed text-subtext1">
              {commitNotice.text}
            </span>
          </span>
        </button>
      )}

      {panel && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPanel(undefined)} />
          {panel === 'runner' && (
          <div className="absolute bottom-full left-0 z-40 mb-1.5 max-h-[min(28rem,70vh)] w-[min(24rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-surface1 bg-mantle p-2 shadow-xl">
            <div className="px-1.5 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-overlay1">실행 환경</div>
            {runnerLocked && activeRunner ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface0/60 px-2.5 py-2 text-[12px] text-subtext1">
                <RunnerIcon runner={activeRunner} className="h-4 w-4 text-sapphire" />
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${providerBadgeClass(activeRunner.provider)}`}>
                  {PROVIDER_LABEL[activeRunner.provider] ?? activeRunner.provider}
                </span>
                <span className="min-w-0 flex-1 truncate">{runnerLabel(activeRunner)}</span>
                <Lock className="h-3.5 w-3.5 text-overlay1" />
              </div>
            ) : (
              <div className="mb-2 space-y-1">
                {PROVIDER_ORDER.flatMap((provider) => runners.filter((runner) => runner.provider === provider)).map((runner) => (
                  <button
                    key={runner.id}
                    onClick={() => {
                      void Promise.resolve(onChooseRunner(runner.id)).finally(() => setPanel(undefined))
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] ${
                      runner.id === activeRunner?.id ? 'bg-surface1 text-text' : 'text-subtext1 hover:bg-surface0'
                    }`}
                  >
                    <RunnerIcon runner={runner} className="h-4 w-4 text-sapphire" />
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${providerBadgeClass(runner.provider)}`}>
                      {PROVIDER_LABEL[runner.provider] ?? runner.provider}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{runnerLabel(runner)}</span>
                  </button>
                ))}
                {runners.length === 0 && (
                  <div className="rounded-lg bg-yellow/10 px-2.5 py-2 text-[11px] text-yellow">
                    실행 가능한 CLI를 찾지 못했습니다.
                  </div>
                )}
              </div>
            )}
          </div>
          )}
          {panel === 'agent' && (
          <div className="absolute bottom-full left-0 z-40 mb-1.5 max-h-[min(28rem,70vh)] w-[min(22rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-surface1 bg-mantle p-2 shadow-xl">
            <div className="px-1.5 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-overlay1">에이전트</div>
            <button
              onClick={() => { onSelect(undefined); setPanel(undefined) }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] ${
                agentName ? 'text-subtext1 hover:bg-surface0' : 'bg-surface1 text-text'
              }`}
            >
              에이전트 없이 실행
            </button>
            {agents.map((agent) => (
              <div
                key={agent.name}
                className={`group flex items-center gap-1 ${
                  agent.name === agentName ? 'rounded-lg bg-surface1' : 'rounded-lg hover:bg-surface0/60'
                }`}
              >
                <button onClick={() => { onSelect(agent.name); setPanel(undefined) }} className="min-w-0 flex-1 px-3 py-2 text-left">
                  <div className="flex items-center gap-1.5 text-[12px] text-text">
                    <Bot className="h-3.5 w-3.5 shrink-0 text-mauve" /> {agent.name}
                  </div>
                  {agent.description && (
                    <div className="truncate text-[11px] text-overlay1">{agent.description}</div>
                  )}
                </button>
                <button
                  onClick={() => { onEdit(agent); setPanel(undefined) }}
                  title="편집"
                  className="mr-2 hidden rounded p-1 text-overlay1 hover:text-text group-hover:block"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={() => { onNew(); setPanel(undefined) }}
              className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
            >
              <Plus className="h-3.5 w-3.5" /> 새 에이전트
            </button>
          </div>
          )}
          {panel === 'commit' && (
            <div className="absolute bottom-full right-0 z-40 mb-1.5 w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-surface1 bg-mantle p-3 shadow-xl">
              {commitNotice ? (
                <>
                <div className={`mb-1 flex items-center gap-1.5 text-[11px] font-medium ${
                  commitNotice.status === 'success' ? 'text-green' : 'text-yellow'
                }`}>
                  {commitNotice.status === 'success'
                    ? <CheckCircle2 className="h-3.5 w-3.5" />
                    : <ShieldAlert className="h-3.5 w-3.5" />}
                  {commitNotice.title}
                </div>
                <div className="whitespace-pre-wrap text-[11px] leading-relaxed text-subtext1">
                  {commitNotice.text}
                </div>
                </>
              ) : (
                <div className="flex items-center gap-2 text-[11px] text-overlay1">
                  <GitCommitHorizontal className="h-4 w-4" /> 아직 자동 반영 내역이 없습니다.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
