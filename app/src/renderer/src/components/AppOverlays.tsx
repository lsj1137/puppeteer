import { ImagePlus } from 'lucide-react'
import type { AppUpdateState } from '@shared/app-update'
import type { AgentDef, DetectedRunner, StoredProject, WorktreeIntegrationMode } from '@shared/session'
import AgentEditor from './AgentEditor'
import AgentImport from './AgentImport'
import ImageAnnotator from './ImageAnnotator'
import Settings from './Settings'

interface Attachment {
  url: string
}

interface EditingAgent {
  agent: AgentDef
  isNew: boolean
}

interface AppOverlaysProps {
  settingsOpen: boolean
  theme: 'dark' | 'light'
  notify: boolean
  runners: DetectedRunner[]
  defaultRunnerId?: string
  worktreeIntegrationMode: WorktreeIntegrationMode
  appUpdate?: AppUpdateState
  hasRunningSessions: boolean
  onToggleTheme: () => void
  onToggleNotify: (enabled: boolean) => void
  onDefaultRunnerChange: (runnerId: string) => void
  onWorktreeIntegrationModeChange: (mode: WorktreeIntegrationMode) => void
  onCloseSettings: () => void
  importing: boolean
  projects: StoredProject[]
  agents: AgentDef[]
  onCloseImport: () => void
  onImported: () => void
  editing?: EditingAgent
  onCloseEditor: () => void
  onAgentSaved: (agent: AgentDef) => void
  onAgentDeleted: (name: string) => void
  annotating?: number
  attachments: Attachment[]
  onCancelAnnotation: () => void
  onSaveAnnotation: (index: number, url: string) => void
  dragOver: boolean
}

/** 앱 전역 설정과 에이전트·이미지 편집처럼 화면 위에 뜨는 오버레이 묶음. */
export default function AppOverlays({
  settingsOpen,
  theme,
  notify,
  runners,
  defaultRunnerId,
  worktreeIntegrationMode,
  appUpdate,
  hasRunningSessions,
  onToggleTheme,
  onToggleNotify,
  onDefaultRunnerChange,
  onWorktreeIntegrationModeChange,
  onCloseSettings,
  importing,
  projects,
  agents,
  onCloseImport,
  onImported,
  editing,
  onCloseEditor,
  onAgentSaved,
  onAgentDeleted,
  annotating,
  attachments,
  onCancelAnnotation,
  onSaveAnnotation,
  dragOver,
}: AppOverlaysProps) {
  const annotatedAttachment = annotating === undefined ? undefined : attachments[annotating]

  return (
    <>
      {settingsOpen && (
        <Settings
          theme={theme}
          onToggleTheme={onToggleTheme}
          notify={notify}
          onToggleNotify={onToggleNotify}
          runners={runners}
          defaultRunnerId={defaultRunnerId}
          onDefaultRunnerChange={onDefaultRunnerChange}
          worktreeIntegrationMode={worktreeIntegrationMode}
          onWorktreeIntegrationModeChange={onWorktreeIntegrationModeChange}
          appUpdate={appUpdate}
          hasRunningSessions={hasRunningSessions}
          onClose={onCloseSettings}
        />
      )}

      {importing && (
        <AgentImport
          projects={projects}
          existingNames={agents.map((agent) => agent.name)}
          onClose={onCloseImport}
          onSaved={onImported}
        />
      )}

      {editing && (
        <AgentEditor
          agent={editing.agent}
          isNew={editing.isNew}
          projects={projects}
          onClose={onCloseEditor}
          onSaved={onAgentSaved}
          onDeleted={onAgentDeleted}
        />
      )}

      {annotatedAttachment && annotating !== undefined && (
        <ImageAnnotator
          src={annotatedAttachment.url}
          onCancel={onCancelAnnotation}
          onSave={(url) => onSaveAnnotation(annotating, url)}
        />
      )}

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-crust/60">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-lavender bg-mantle px-8 py-6">
            <ImagePlus className="h-8 w-8 text-lavender" />
            <span className="text-sm text-text">놓으면 이미지가 첨부됩니다</span>
          </div>
        </div>
      )}
    </>
  )
}
