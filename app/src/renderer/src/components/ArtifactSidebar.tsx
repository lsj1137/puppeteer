import type { Dispatch, SetStateAction } from 'react'
import { FileDiff, GitBranch, PanelRightOpen } from 'lucide-react'
import type { ChangedFile } from '@shared/session'
import type { SessionView } from '../lib/session-view'
import { clampArtifactWidth } from '../lib/session-view'
import ArtifactPanel from './ArtifactPanel'

interface Props {
  changes: ChangedFile[]
  open: boolean
  selectedId?: string
  view: SessionView
  width: number
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
  onOpenDiff,
  onSelect,
  onToggle,
  setWidth,
}: Props) {
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
      {(view.snapshot || changes.length > 0) && (
        <div className="shrink-0 border-b border-surface0 px-2.5 pb-2.5 pt-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-overlay1">
            <GitBranch className="h-3.5 w-3.5" /> Git
          </div>
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
        </div>
      )}
      <ArtifactPanel
        artifacts={view.artifacts}
        selectedId={selectedId}
        onSelect={onSelect}
        onCollapse={onToggle}
      />
    </aside>
  )
}
