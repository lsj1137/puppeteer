import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, File, FileDiff, Folder, GitBranch, GitCommitHorizontal, ListTree, Loader2, PackageOpen, PanelRightClose, PanelRightOpen, RefreshCw, Settings2 } from 'lucide-react'
import type { ChangedFile, GitHistoryEntry, ProjectFileEntry, ProjectFilePreview, SessionWorktree, WorktreeStatus } from '@shared/session'
import type { SessionView } from '../lib/session-view'
import { clampArtifactWidth } from '../lib/session-view'
import ArtifactPanel from './ArtifactPanel'
import Code from './Code'

interface Props {
  changes: ChangedFile[]
  open: boolean
  focusArtifactRequest: number
  selectedId?: string
  view: SessionView
  width: number
  rootPath?: string
  sessionId?: string
  worktree?: SessionWorktree | null
  onOpenDiff: (path: string) => void | Promise<void>
  onManageWorktree: () => void
  onSelect: (id: string) => void
  onToggle: () => void
  setWidth: Dispatch<SetStateAction<number>>
}

export default function ArtifactSidebar({
  changes,
  open,
  focusArtifactRequest,
  selectedId,
  view,
  width,
  rootPath,
  sessionId,
  worktree,
  onOpenDiff,
  onManageWorktree,
  onSelect,
  onToggle,
  setWidth,
}: Props) {
  const [tab, setTab] = useState<'instructions' | 'git' | 'artifacts' | 'files'>(() =>
    (localStorage.getItem('ws.sidebarTab') as 'instructions' | 'git' | 'artifacts' | 'files') || 'artifacts',
  )
  const [files, setFiles] = useState<ProjectFileEntry[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [gitRepository, setGitRepository] = useState(false)
  const [preview, setPreview] = useState<ProjectFilePreview>()
  const [history, setHistory] = useState<GitHistoryEntry[]>([])
  const [worktreeStatus, setWorktreeStatus] = useState<WorktreeStatus>()
  const [gitLoading, setGitLoading] = useState(false)
  const initializedFileRoot = useRef<string | undefined>(undefined)

  const reloadGit = useCallback(async (): Promise<void> => {
    if (!rootPath) return
    setGitLoading(true)
    try {
      const [nextHistory, nextStatus] = await Promise.all([
        window.api.gitHistory(rootPath, 60),
        sessionId && worktree ? window.api.worktreeStatus(sessionId) : Promise.resolve(undefined),
      ])
      setHistory(nextHistory)
      setWorktreeStatus(nextStatus)
    } finally {
      setGitLoading(false)
    }
  }, [rootPath, sessionId, worktree])

  useEffect(() => {
    setPreview(undefined)
    if (!rootPath) return setGitRepository(false)
    let cancelled = false
    void window.api.isGitRepository(rootPath).then((value) => {
      if (cancelled) return
      setGitRepository(value)
      if (!value && tab === 'git') selectTab('artifacts')
    }).catch(() => {
      if (!cancelled) setGitRepository(false)
    })
    return () => { cancelled = true }
  }, [rootPath, tab])

  useEffect(() => {
    if (!open || tab !== 'files' || !rootPath) return
    let cancelled = false
    setFiles([])
    void window.api.listProjectFiles(rootPath).then((next) => {
      if (cancelled) return
      setFiles(next)
      if (initializedFileRoot.current !== rootPath) {
        setCollapsed(new Set(next.filter((entry) => entry.kind === 'directory').map((entry) => entry.path)))
        initializedFileRoot.current = rootPath
      }
    }).catch(() => {
      if (!cancelled) setFiles([])
    })
    return () => { cancelled = true }
  }, [changes, open, rootPath, tab])

  useEffect(() => {
    if (!open || tab !== 'git' || !rootPath) return
    void reloadGit()
  }, [changes, open, reloadGit, rootPath, tab])

  useEffect(() => window.api.onSessionEvent(({ sessionId: changedId, event }) => {
    if (tab !== 'git' || changedId !== sessionId || event.t !== 'status' || event.status !== 'completed') return
    window.setTimeout(() => void reloadGit(), 150)
  }), [reloadGit, sessionId, tab])

  const selectTab = (next: 'instructions' | 'git' | 'artifacts' | 'files'): void => {
    setTab(next)
    localStorage.setItem('ws.sidebarTab', next)
  }

  useEffect(() => {
    if (focusArtifactRequest <= 0) return
    setTab('artifacts')
    localStorage.setItem('ws.sidebarTab', 'artifacts')
  }, [focusArtifactRequest])
  const startResize = (event: React.PointerEvent): void => {
    event.preventDefault()
    const move = (pointer: PointerEvent): void =>
      setWidth(clampArtifactWidth(window.innerWidth - pointer.clientX))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidth((current) => {
        localStorage.setItem('ws.artifactW', String(current))
        return current
      })
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!open) {
    return (
      <aside className="col-start-3 row-start-2 row-end-4 flex flex-col items-center gap-2 border-l border-surface0 bg-mantle py-2.5">
        <button
          onClick={onToggle}
          title="Artifacts 펼치기"
          className="rounded p-1.5 text-subtext0 hover:bg-surface0 hover:text-text"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
        {view.artifacts.length > 0 && (
          <span className="rounded bg-sapphire/20 px-1 text-[11px] text-sapphire">
            {view.artifacts.length}
          </span>
        )}
        {changes.length > 0 && (
          <span className="rounded bg-peach/20 px-1 text-[11px] text-peach">{changes.length}</span>
        )}
      </aside>
    )
  }

  return (
    <aside
      className="relative col-start-3 row-start-2 row-end-4 flex min-h-0 flex-col overflow-hidden border-l border-surface0 bg-mantle"
      style={{ width }}
    >
      <div
        onPointerDown={startResize}
        onDoubleClick={() => {
          setWidth(380)
          localStorage.setItem('ws.artifactW', '380')
        }}
        title="드래그로 폭 조절 · 더블클릭으로 초기화"
        className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-lavender/40"
      />
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-2">
        <div className="flex min-w-0 items-center gap-0.5 rounded-lg bg-surface0/55 p-0.5">
        {([
          ['instructions', ListTree, '지시', view.entries.filter((entry) => entry.kind === 'user').length],
          ['git', GitBranch, 'Git', changes.length],
          ['artifacts', PackageOpen, '아티팩트', view.artifacts.length],
          ['files', Folder, '파일', 0],
        ] as const).filter(([id]) => id !== 'git' || gitRepository).map(([id, Icon, label, count]) => (
          <button
            key={id}
            onClick={() => selectTab(id)}
            className={`flex min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] transition-colors ${
              tab === id ? 'bg-base/85 text-text shadow-sm' : 'text-overlay1 hover:text-subtext1'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{label}</span>
            {count > 0 && <span className="text-[10px] text-overlay1">{count}</span>}
          </button>
        ))}
        </div>
        <span className="flex-1" />
        <button onClick={onToggle} title="패널 접기" className="rounded-md p-1.5 text-overlay1 hover:bg-surface0 hover:text-text">
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {tab === 'instructions' && (
        <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-3">
          <div className="sticky top-0 z-[1] mb-1 bg-mantle/95 px-1 py-2 text-[12px] font-semibold text-subtext0 backdrop-blur">
            지시 기록
          </div>
          {view.entries.some((entry) => entry.kind === 'user') ? (
            <div className="space-y-1">
              {view.entries.filter((entry) => entry.kind === 'user').map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => document.getElementById(`conversation-entry-${entry.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                  className="group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface0/65"
                >
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] text-overlay1">{index + 1}</span>
                  <span className="line-clamp-3 min-w-0 text-[13px] leading-relaxed text-subtext1 group-hover:text-text">
                    {entry.text}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-1 py-2 text-[12px] text-overlay1">아직 지시 기록이 없습니다.</div>
          )}
        </div>
      )}

      {tab === 'git' && (
        <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-3">
          <div className="sticky top-0 z-[1] -mx-0.5 mb-2 flex items-center gap-2 bg-mantle/95 px-1 py-2 backdrop-blur">
            <GitBranch className="h-4 w-4 shrink-0 text-teal" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-text">
                {worktree?.branch ?? view.snapshot?.branch ?? 'Git'}
              </div>
              <div className="truncate font-mono text-[11px] text-overlay1">
                {worktreeStatus?.baseBranch ? `${worktreeStatus.baseBranch} 기준` : view.snapshot?.head}
              </div>
            </div>
            <button type="button" onClick={() => void reloadGit()} disabled={gitLoading} title="Git 상태 새로고침" className="rounded-md p-1.5 text-overlay1 hover:bg-surface0 hover:text-text disabled:opacity-40">
              <RefreshCw className={`h-3.5 w-3.5 ${gitLoading ? 'animate-spin' : ''}`} />
            </button>
            {worktree && sessionId && (
              <button type="button" onClick={onManageWorktree} title="커밋·병합 관리" className="rounded-md p-1.5 text-overlay1 hover:bg-surface0 hover:text-text">
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {worktreeStatus && (
            <div className="mb-3 rounded-lg bg-base/55 p-2.5">
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className={`rounded px-1.5 py-0.5 ${worktreeStatus.dirty ? 'bg-yellow/15 text-yellow' : 'bg-surface0 text-subtext0'}`}>
                  변경 {worktreeStatus.dirty ? '있음' : '없음'}
                </span>
                <span className="rounded bg-surface0 px-1.5 py-0.5 text-subtext0">ahead {worktreeStatus.ahead}</span>
                <span className="rounded bg-surface0 px-1.5 py-0.5 text-subtext0">behind {worktreeStatus.behind}</span>
                <span className={`rounded px-1.5 py-0.5 ${worktreeStatus.canMerge ? 'bg-green/15 text-green' : 'bg-surface0 text-overlay1'}`}>
                  fast-forward {worktreeStatus.canMerge ? '가능' : '불가'}
                </span>
              </div>
              {worktreeStatus.reason && !worktreeStatus.merged && (
                <div className="mt-2 flex gap-1.5 text-[12px] leading-relaxed text-yellow">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{worktreeStatus.reason}</span>
                </div>
              )}
              {worktreeStatus.integration && (
                <div className="mt-2 border-t border-surface0 pt-2">
                  <div className="flex items-center gap-1.5">
                    {['checking', 'committing', 'merging'].includes(worktreeStatus.integration.phase)
                      ? <Loader2 className="h-3 w-3 animate-spin text-blue" />
                      : worktreeStatus.integration.phase === 'completed'
                        ? <CheckCircle2 className="h-3 w-3 text-green" />
                        : <AlertTriangle className="h-3 w-3 text-yellow" />}
                    <span className="text-[12px] font-medium text-subtext1">{worktreeStatus.integration.summary}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-overlay1">
                    {worktreeStatus.integration.mode === 'auto'
                      ? '자동 병합'
                      : worktreeStatus.integration.mode === 'off'
                        ? 'Worktree 사용 안 함'
                        : '병합 제안'} · {new Date(worktreeStatus.integration.updatedAt).toLocaleString()}
                  </div>
                  {worktreeStatus.integration.detail && (
                    <div className="mt-1.5 whitespace-pre-wrap break-words rounded bg-crust/40 px-2 py-1.5 font-mono text-[11px] text-overlay1">
                      {worktreeStatus.integration.detail}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {changes.length > 0 && (
            <>
              <div className="mb-1 text-[12px] font-medium text-subtext0">
                세션 시작 이후 변경 {changes.length}건
              </div>
              <div className="max-h-28 overflow-auto">
                {changes.map((change) => (
                  <button
                    key={change.path}
                    onClick={() => void onOpenDiff(change.path)}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[13px] hover:bg-surface0"
                  >
                    <span
                      className={`shrink-0 font-mono text-[12px] font-bold ${
                        change.status === '??'
                          ? 'text-green'
                          : change.status === 'D'
                            ? 'text-red'
                            : 'text-yellow'
                      }`}
                      title={change.status === '??' ? '새 파일' : change.status === 'D' ? '삭제' : '수정'}
                    >
                      {change.status === '??' ? '+' : change.status === 'D' ? '−' : '~'}
                    </span>
                    <span className="flex-1 truncate text-subtext1">{change.path}</span>
                    <FileDiff className="h-3 w-3 shrink-0 text-overlay1" />
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="mb-1 mt-3 flex items-center gap-1.5 text-[12px] font-medium text-subtext0">
            <GitCommitHorizontal className="h-3.5 w-3.5" /> 최근 커밋
          </div>
          {history.length > 0 ? (
            <div className="relative ml-1 border-l border-surface1 pl-3">
              {history.map((commit) => (
                <div key={commit.hash} className="relative pb-3 last:pb-0">
                  <span className="absolute -left-[16.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-overlay0 ring-2 ring-mantle" />
                  <div className="break-words text-[12px] leading-snug text-subtext1">{commit.subject}</div>
                  <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-overlay1">
                    <span className="shrink-0 font-mono text-sapphire">{commit.shortHash}</span>
                    <span className="truncate">{commit.author}</span>
                    <span className="ml-auto shrink-0">{formatHistoryDate(commit.authoredAt)}</span>
                  </div>
                  {commit.refs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {commit.refs.map((ref) => <span key={ref} className="rounded bg-teal/10 px-1 py-0.5 font-mono text-[10px] text-teal">{ref}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : !gitLoading && (
            <div className="text-[12px] text-overlay1">표시할 커밋 이력이 없습니다.</div>
          )}
        </div>
      )}
      {tab === 'artifacts' && (
        <ArtifactPanel artifacts={view.artifacts} selectedId={selectedId} onSelect={onSelect} />
      )}
      {tab === 'files' && (
        <div className="flex min-h-0 flex-1 flex-col px-1.5 pb-1.5">
          <div className={`${preview ? 'max-h-[42%]' : 'flex-1'} min-h-0 overflow-auto rounded-lg bg-base/40 p-1`}>
          {files.length === 0 && <div className="p-2 text-[12px] text-overlay1">표시할 파일이 없습니다</div>}
          {files.filter((entry) => {
            const parts = entry.path.split('/')
            return !parts.slice(0, -1).some((_, index) => collapsed.has(parts.slice(0, index + 1).join('/')))
          }).map((entry) => {
            const depth = entry.path.split('/').length - 1
            const name = entry.path.split('/').at(-1)
            const isCollapsed = collapsed.has(entry.path)
            return (
              <button
                key={entry.path}
                type="button"
                onClick={() => {
                  if (entry.kind === 'directory') {
                    setCollapsed((current) => {
                      const next = new Set(current)
                      if (next.has(entry.path)) next.delete(entry.path)
                      else next.add(entry.path)
                      return next
                    })
                    return
                  }
                  if (!rootPath) return
                  void window.api.readProjectFile(rootPath, entry.path).then(setPreview)
                }}
                title={entry.path}
                className={`flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[12px] hover:bg-surface0/60 ${
                  preview?.path === entry.path ? 'bg-surface0 text-text' : 'text-subtext1'
                }`}
                style={{ paddingLeft: 6 + depth * 14 }}
              >
                {entry.kind === 'directory' ? (
                  <>{isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}<Folder className="h-3.5 w-3.5 text-yellow" /></>
                ) : (
                  <><span className="w-3" /><File className="h-3.5 w-3.5 text-overlay1" /></>
                )}
                <span className="truncate">{name}</span>
              </button>
            )
          })}
          </div>
          {preview && (
            <div className="mt-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-base/70">
              <div className="flex items-center gap-2 px-2.5 py-2">
                <File className="h-3.5 w-3.5 shrink-0 text-sapphire" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-subtext1">{preview.path}</span>
                <span className="shrink-0 text-[10px] text-overlay1">{formatBytes(preview.size)}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-1.5">
                {preview.content !== undefined ? (
                  <Code code={preview.content} language={preview.path.split('.').at(-1)} lineNumbers />
                ) : (
                  <div className="rounded-md bg-surface0/50 p-3 text-[11px] text-overlay1">
                    {preview.reason === 'binary'
                      ? '바이너리 파일은 미리볼 수 없습니다.'
                      : preview.reason === 'too-large'
                        ? '1MB보다 큰 파일은 미리보기를 제공하지 않습니다.'
                        : '파일을 읽을 수 없습니다.'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatHistoryDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
