import { FolderPlus, Loader2, Monitor, ShieldAlert, Terminal, Trash2 } from 'lucide-react'
import type {
  ApprovalRequest,
  DetectedRunner,
  RunningSession,
  StoredProject,
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
  onPickFolder: () => void | Promise<void>
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
    onPickFolder,
    onSelectProject,
  } = props

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
                onClick={() => void onJump(approval.sessionId, projectPath)}
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
                onClick={() => void onSelectProject(project.path)}
                className={`group cursor-pointer rounded-md px-2 py-1.5 ${
                  active ? 'bg-surface0' : 'hover:bg-surface0/50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`flex-1 truncate text-sm ${active ? 'text-text' : 'text-subtext1'}`}
                    title={project.path}
                  >
                    {baseName(project.path)}
                  </span>
                  {live > 0 && (
                    <span className="shrink-0 rounded bg-green/20 px-1 text-[11px] text-green">{live}</span>
                  )}
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
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
