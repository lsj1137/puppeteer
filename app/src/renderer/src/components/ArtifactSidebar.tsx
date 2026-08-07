import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { ChevronDown, ChevronRight, File, FileDiff, Folder, GitBranch, PackageOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { ChangedFile, ProjectFileEntry, ProjectFilePreview } from '@shared/session'
import type { SessionView } from '../lib/session-view'
import { clampArtifactWidth } from '../lib/session-view'
import ArtifactPanel from './ArtifactPanel'
import Code from './Code'

interface Props {
  changes: ChangedFile[]
  open: boolean
  selectedId?: string
  view: SessionView
  width: number
  rootPath?: string
  onOpenDiff: (path: string) => void | Promise<void>
  onSelect: (id: string) => void
  onToggle: () => void
  setWidth: Dispatch<SetStateAction<number>>
}

export default function ArtifactSidebar({
  changes,
  open,
  selectedId,
  view,
  width,
  rootPath,
  onOpenDiff,
  onSelect,
  onToggle,
  setWidth,
}: Props) {
  const [tab, setTab] = useState<'git' | 'artifacts' | 'files'>(() =>
    (localStorage.getItem('ws.sidebarTab') as 'git' | 'artifacts' | 'files') || 'artifacts',
  )
  const [files, setFiles] = useState<ProjectFileEntry[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [gitRepository, setGitRepository] = useState(false)
  const [preview, setPreview] = useState<ProjectFilePreview>()

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
      if (!cancelled) setFiles(next)
    }).catch(() => {
      if (!cancelled) setFiles([])
    })
    return () => { cancelled = true }
  }, [changes, open, rootPath, tab])

  const selectTab = (next: 'git' | 'artifacts' | 'files'): void => {
    setTab(next)
    localStorage.setItem('ws.sidebarTab', next)
  }
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
          ['git', GitBranch, 'Git', changes.length],
          ['artifacts', PackageOpen, '아티팩트', view.artifacts.length],
          ['files', Folder, '파일', 0],
        ] as const).filter(([id]) => id !== 'git' || gitRepository).map(([id, Icon, label, count]) => (
          <button
            key={id}
            onClick={() => selectTab(id)}
            className={`flex min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] transition-colors ${
              tab === id ? 'bg-surface1 text-text shadow-sm' : 'text-overlay1 hover:text-subtext1'
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

      {tab === 'git' && (
        <div className="min-h-0 flex-1 overflow-auto px-2.5 py-3">
          {view.snapshot && (
            <div className="mb-2 flex items-center gap-1.5 pl-0.5 text-[11px]">
              <span className="rounded bg-surface0 px-1.5 py-0.5 text-subtext1">
                {view.snapshot.branch}
              </span>
              <span className="font-mono text-overlay1">{view.snapshot.head}</span>
            </div>
          )}
          {changes.length > 0 && (
            <>
              <div className="mb-1 text-[11px] text-overlay1">
                세션 시작 이후 변경 {changes.length}건
              </div>
              <div className="max-h-28 overflow-auto">
                {changes.map((change) => (
                  <button
                    key={change.path}
                    onClick={() => void onOpenDiff(change.path)}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] hover:bg-surface0"
                  >
                    <span
                      className={`shrink-0 font-mono text-[11px] font-bold ${
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
          {!view.snapshot && changes.length === 0 && (
            <div className="text-[12px] text-overlay1">표시할 Git 변경이 없습니다</div>
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
