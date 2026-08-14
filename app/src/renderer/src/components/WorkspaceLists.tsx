import { useState } from 'react'
import { FolderPlus, GitBranch, Loader2, Monitor, Pencil, RefreshCw, ShieldAlert, Terminal, Trash2 } from 'lucide-react'
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
  onSetProjectWorktreeMode: (path: string, mode: WorktreeIntegrationMode) => void | Promise<void>
  onRelinkProject: (path: string) => void | Promise<void>
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
  const [worktreeMenu, setWorktreeMenu] = useState<string>()

  const finishRename = (path: string): void => {
    void onRenameProject(path, projectAlias)
    setEditingProject(undefined)
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
                  {editingProject === project.path ? (
                    <input
                      autoFocus
                      value={projectAlias}
                      onChange={(event) => setProjectAlias(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onBlur={() => finishRename(project.path)}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') finishRename(project.path)
                        if (event.key === 'Escape') setEditingProject(undefined)
                      }}
                      className="min-w-0 flex-1 rounded border border-surface1 bg-base px-1.5 py-0.5 text-sm text-text outline-none focus:border-sapphire"
                      aria-label="프로젝트 별칭"
                    />
                  ) : (
                    <span
                      className={`flex-1 truncate text-sm ${active ? 'text-text' : 'text-subtext1'}`}
                      title={project.alias ? `${project.alias}\n${project.path}` : project.path}
                      onDoubleClick={(event) => {
                        event.stopPropagation()
                        setProjectAlias(project.alias ?? baseName(project.path))
                        setEditingProject(project.path)
                      }}
                    >
                      {project.alias || baseName(project.path)}
                    </span>
                  )}
                  {live > 0 && (
                    <span className="shrink-0 rounded bg-green/20 px-1 text-[11px] text-green">{live}</span>
                  )}
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      setWorktreeMenu((current) => current === project.path ? undefined : project.path)
                    }}
                    className="hidden rounded p-0.5 text-overlay1 hover:bg-surface1 hover:text-text group-hover:block"
                    title="Worktree 방식"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      void onRelinkProject(project.path)
                    }}
                    className="hidden rounded p-0.5 text-overlay1 hover:bg-sapphire/15 hover:text-sapphire group-hover:block"
                    title="이동한 프로젝트 폴더 재연결"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      setProjectAlias(project.alias ?? baseName(project.path))
                      setEditingProject(project.path)
                    }}
                    className="hidden rounded p-0.5 text-overlay1 hover:bg-surface1 hover:text-text group-hover:block"
                    title="프로젝트 별칭 변경"
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
                {worktreeMenu === project.path && (
                  <div
                    className="mt-1 rounded-md border border-surface1 bg-mantle p-1 shadow-lg"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {([
                      ['off', '사용 안 함', '원본 폴더에서 실행 · 자동 Git 반영 없음'],
                      ['suggest', '병합 제안', 'Worktree 격리 · 직접 검토 후 반영'],
                      ['auto', '자동 병합', 'Worktree 변경을 자동 커밋·안전 병합'],
                    ] as const).map(([mode, label, description]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          void onSetProjectWorktreeMode(project.path, mode)
                          setWorktreeMenu(undefined)
                        }}
                        className={`block w-full rounded px-2 py-1.5 text-left ${
                          (project.worktreeMode ?? 'suggest') === mode ? 'bg-surface1' : 'hover:bg-surface0'
                        }`}
                      >
                        <span className="block text-[11px] font-medium text-text">{label}</span>
                        <span className="block text-[10px] text-overlay1">{description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
