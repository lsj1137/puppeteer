import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus, GitBranch, Loader2, Monitor, Pencil, ShieldAlert, Terminal, Trash2, X } from 'lucide-react'
import type {
  ApprovalRequest,
  DetectedRunner,
  RunningSession,
  StoredProject,
  WorktreeIntegrationMode,
} from '@shared/session'
import { runnerEnvironmentLabel } from '@shared/runner'
import { approvalNavigationPath } from '../lib/navigation'
import { baseName } from '../lib/session-view'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  activeProjectPath?: string
  activeSessionId?: string
  approvals: ApprovalRequest[]
  projects: StoredProject[]
  runners: DetectedRunner[]
  running: RunningSession[]
  onDropProject: (path: string) => void
  onJump: (sessionId: string, projectPath: string) => void | Promise<void>
  onOpenApproval: (approval: ApprovalRequest) => void | Promise<void>
  onPickFolder: () => void | Promise<void>
  onRenameProject: (path: string, alias: string) => void | Promise<void>
  onSetProjectWorktreeMode: (path: string, mode: WorktreeIntegrationMode) => Promise<void>
  onRelinkProject: (path: string) => Promise<boolean>
  onReorderProjects: (paths: string[]) => void
  onSelectProject: (path: string) => void | Promise<void>
}

const runnerLabel = (runner: DetectedRunner): string =>
  runnerEnvironmentLabel(runner) + (runner.version ? ` · ${runner.version}` : '')

export default function WorkspaceLists(props: Props) {
  const {
    activeProjectPath,
    activeSessionId,
    approvals,
    projects,
    runners,
    running,
    onDropProject,
    onJump,
    onOpenApproval,
    onPickFolder,
    onRenameProject,
    onSetProjectWorktreeMode,
    onRelinkProject,
    onReorderProjects,
    onSelectProject,
  } = props
  const [draggingProject, setDraggingProject] = useState<string>()
  const [dropTarget, setDropTarget] = useState<string>()
  const [editingProject, setEditingProject] = useState<string>()
  const [projectAlias, setProjectAlias] = useState('')
  const [projectMode, setProjectMode] = useState<WorktreeIntegrationMode>('suggest')
  const [projectError, setProjectError] = useState<string>()
  const [projectSaving, setProjectSaving] = useState(false)
  const [confirmProjectClose, setConfirmProjectClose] = useState(false)
  const editing = projects.find(({ path }) => path === editingProject)
  const projectDirty = Boolean(editing && (
    projectAlias !== (editing.alias ?? baseName(editing.path))
    || projectMode !== (editing.worktreeMode ?? 'suggest')
  ))

  const openProjectEditor = (project: StoredProject): void => {
    setEditingProject(project.path)
    setProjectAlias(project.alias ?? baseName(project.path))
    setProjectMode(project.worktreeMode ?? 'suggest')
    setProjectError(undefined)
  }
  const requestProjectClose = (): void => {
    if (projectDirty) setConfirmProjectClose(true)
    else setEditingProject(undefined)
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && editingProject && !confirmProjectClose && !projectSaving) {
        requestProjectClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const saveProject = async (): Promise<void> => {
    if (!editing) return
    setProjectSaving(true)
    setProjectError(undefined)
    try {
      await onSetProjectWorktreeMode(editing.path, projectMode)
      await onRenameProject(editing.path, projectAlias)
      setEditingProject(undefined)
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error))
    } finally {
      setProjectSaving(false)
    }
  }


  return (
    <>
      {approvals.length > 0 && (
        <section className="rounded-md border border-peach/40 bg-peach/5 p-2">
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-peach">
            <ShieldAlert className="h-3.5 w-3.5" /> 승인 대기 {approvals.length}
          </div>
          {approvals.map((approval) => {
            const projectPath = approvalNavigationPath(approval)
            return (
              <button
                key={approval.id}
                onClick={() => void onOpenApproval(approval)}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] hover:bg-surface0"
              >
                <span className="font-mono text-subtext1">{approval.tool}</span>
                <span className="flex-1 truncate text-overlay1">{baseName(projectPath)}</span>
                {approval.sessionId === activeSessionId && (
                  <span className="shrink-0 text-[11px] text-peach">현재</span>
                )}
              </button>
            )
          })}
        </section>
      )}

      {running.length > 0 && (
        <section>
          <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-overlay1">
            실행 중 {running.length}
          </div>
          {running.map((session) => (
            <button
              key={session.id}
              onClick={() => void onJump(session.id, session.projectPath)}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] ${
                session.id === activeSessionId ? 'bg-surface0' : 'hover:bg-surface0/50'
              }`}
            >
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-green" />
              <span className="flex-1 truncate text-subtext1">{session.title}</span>
              <span className="shrink-0 text-overlay1">{baseName(session.projectPath)}</span>
            </button>
          ))}
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-overlay1">프로젝트</span>
          <button
            onClick={() => void onPickFolder()}
            className="rounded p-1 text-subtext0 hover:bg-surface0 hover:text-text"
            title="폴더 추가"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
        {projects.length === 0 && (
          <div className="px-1 text-[12px] text-overlay1">＋ 로 폴더를 추가하세요</div>
        )}
        <div className="space-y-0.5">
          {projects.map((project) => {
            const runner = runners.find(({ id }) => id === project.runnerId)
            const active = project.path === activeProjectPath
            const live = running.filter(({ projectPath }) => projectPath === project.path).length
            const Icon = runner?.kind === 'wsl' ? Terminal : Monitor
            return (
              <div
                key={project.path}
                draggable
                onDragStart={(event) => {
                  setDraggingProject(project.path)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', project.path)
                }}
                onDragOver={(event) => {
                  if (!draggingProject || draggingProject === project.path) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropTarget(project.path)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const source = draggingProject ?? event.dataTransfer.getData('text/plain')
                  if (!source || source === project.path) return
                  const paths = projects.map(({ path }) => path)
                  const from = paths.indexOf(source)
                  const to = paths.indexOf(project.path)
                  if (from < 0 || to < 0) return
                  const [moved] = paths.splice(from, 1)
                  if (!moved) return
                  paths.splice(to, 0, moved)
                  onReorderProjects(paths)
                  setDraggingProject(undefined)
                  setDropTarget(undefined)
                }}
                onDragEnd={() => {
                  setDraggingProject(undefined)
                  setDropTarget(undefined)
                }}
                onClick={() => void onSelectProject(project.path)}
                className={`group relative cursor-grab rounded-md px-2 py-1.5 transition active:cursor-grabbing ${
                  dropTarget === project.path ? 'bg-sapphire/10 ring-1 ring-sapphire/70' : ''
                } ${draggingProject === project.path ? 'scale-[1.01] bg-surface1/80 shadow-md' : ''} ${
                  active ? 'bg-surface0' : 'hover:bg-surface0/50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`flex-1 truncate text-sm ${active ? 'text-text' : 'text-subtext1'}`}
                    title={project.alias ? `${project.alias}\n${project.path}` : project.path}
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      openProjectEditor(project)
                    }}
                  >
                    {project.alias || baseName(project.path)}
                  </span>
                  {live > 0 && (
                    <span className="shrink-0 rounded bg-green/20 px-1 text-[11px] text-green">{live}</span>
                  )}
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      openProjectEditor(project)
                    }}
                    className="hidden rounded p-0.5 text-overlay1 hover:bg-surface1 hover:text-text group-hover:block"
                    title="프로젝트 설정"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      onDropProject(project.path)
                    }}
                    className="hidden rounded p-0.5 text-overlay1 hover:bg-red/20 hover:text-red group-hover:block"
                    title="목록에서 제거 (폴더는 삭제되지 않음)"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-overlay1">
                  {runner ? (
                    <>
                      <Icon className="h-3 w-3" /> {runnerLabel(runner)}
                    </>
                  ) : (
                    '실행 환경 미지정'
                  )}
                  <span>·</span>
                  <GitBranch className="h-3 w-3" />
                  <span>{
                    project.worktreeMode === 'off'
                      ? 'Worktree 끔'
                      : project.worktreeMode === 'auto'
                        ? '자동 병합'
                        : '병합 제안'
                  }</span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-crust/70 p-6 backdrop-blur-[2px]">
          <section className="w-full max-w-lg overflow-hidden rounded-2xl bg-mantle shadow-2xl ring-1 ring-surface1">
            <header className="flex items-start gap-3 border-b border-surface0 px-5 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sapphire/15 text-sapphire">
                <FolderOpen className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-text">프로젝트 설정</h2>
                <p className="mt-0.5 truncate font-mono text-[10px] text-overlay1">{editing.path}</p>
              </div>
              <button type="button" onClick={requestProjectClose} title="닫기" className="rounded p-1.5 text-overlay1 hover:bg-surface0 hover:text-text">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="space-y-4 p-5">
              <label className="block text-[11px] text-subtext0">
                프로젝트 별칭
                <input
                  autoFocus
                  value={projectAlias}
                  onChange={(event) => setProjectAlias(event.target.value)}
                  className="mt-1 w-full rounded-lg bg-base px-3 py-2 text-[13px] text-text outline-none ring-1 ring-surface1 focus:ring-sapphire/50"
                />
              </label>

              <div>
                <div className="mb-1.5 text-[11px] text-subtext0">Worktree 정책</div>
                <div className="space-y-1.5">
                  {([
                    ['off', '사용 안 함', '다음 새 세션부터 원본 폴더에서 실행하고 자동 Git 반영을 하지 않습니다. 기존 Worktree는 안전할 때만 모두 정리합니다.'],
                    ['suggest', '병합 제안', 'Worktree에서 격리 실행하고 커밋·병합은 사용자가 검토합니다.'],
                    ['auto', '자동 병합', '완료된 변경을 자동 커밋하고 안전한 fast-forward만 수행합니다.'],
                  ] as const).map(([mode, label, description]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setProjectMode(mode)}
                      className={`block w-full rounded-lg px-3 py-2 text-left ring-1 ${
                        projectMode === mode
                          ? 'bg-sapphire/10 text-text ring-sapphire/40'
                          : 'bg-base text-subtext1 ring-transparent hover:ring-surface1'
                      }`}
                    >
                      <span className="block text-[12px] font-medium">{label}</span>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-overlay1">{description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                disabled={projectSaving}
                onClick={async () => {
                  if (await onRelinkProject(editing.path)) setEditingProject(undefined)
                }}
                className="flex w-full items-center gap-2 rounded-lg bg-base px-3 py-2 text-left text-[12px] text-subtext1 hover:bg-surface0 hover:text-text disabled:opacity-40"
              >
                <FolderOpen className="h-4 w-4 text-sapphire" /> 폴더 위치 변경·재연결
              </button>
              {projectError && <div className="whitespace-pre-wrap rounded-lg bg-red/10 px-3 py-2 text-[11px] text-red">{projectError}</div>}
            </div>

            <footer className="flex justify-end gap-2 border-t border-surface0 px-5 py-3">
              <button type="button" disabled={projectSaving} onClick={requestProjectClose} className="rounded-md px-3 py-1.5 text-[12px] text-overlay1 hover:bg-surface0 disabled:opacity-40">취소</button>
              <button type="button" disabled={projectSaving} onClick={() => void saveProject()} className="rounded-md bg-sapphire/20 px-3.5 py-1.5 text-[12px] font-medium text-sapphire hover:bg-sapphire/30 disabled:opacity-40">
                {projectSaving ? '확인 중…' : '저장'}
              </button>
            </footer>
          </section>
        </div>
      )}
      {confirmProjectClose && (
        <ConfirmDialog
          title="프로젝트 설정을 닫을까요?"
          description="저장하지 않은 별칭 또는 Worktree 정책 변경이 사라집니다."
          confirmLabel="저장하지 않고 닫기"
          tone="danger"
          onCancel={() => setConfirmProjectClose(false)}
          onConfirm={() => {
            setConfirmProjectClose(false)
            setEditingProject(undefined)
          }}
        />
      )}
    </>
  )
}
