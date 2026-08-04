import type {
  AgentDef,
  CheckpointDraft,
  DetectedRunner,
  RunningSession,
  StoredSession,
} from '@shared/session'
import Checkpoint from './Checkpoint'
import ConfirmDialog from './ConfirmDialog'
import WorktreeDialog from './WorktreeDialog'

interface WorkspaceDialogsProps {
  confirmDrop?: string
  onConfirmDrop: (projectPath: string) => void
  onCancelDrop: () => void
  confirmDelete?: StoredSession
  deleteError?: string
  running: RunningSession[]
  onConfirmDelete: (sessionId: string) => void
  onCancelDelete: () => void
  checkpoint?: CheckpointDraft
  runners: DetectedRunner[]
  agents: AgentDef[]
  onCloseCheckpoint: () => void
  onHandoff: (body: string, runnerId: string, agentName?: string) => void
  worktreeSession?: StoredSession
  onWorktreeChanged: () => void
  onCloseWorktree: () => void
}

/** 프로젝트·세션의 파괴적 동작과 작업 인계에 관련된 전역 대화상자 묶음. */
export default function WorkspaceDialogs({
  confirmDrop,
  onConfirmDrop,
  onCancelDrop,
  confirmDelete,
  deleteError,
  running,
  onConfirmDelete,
  onCancelDelete,
  checkpoint,
  runners,
  agents,
  onCloseCheckpoint,
  onHandoff,
  worktreeSession,
  onWorktreeChanged,
  onCloseWorktree,
}: WorkspaceDialogsProps) {
  return (
    <>
      {confirmDrop && (
        <ConfirmDialog
          tone="danger"
          title="프로젝트를 목록에서 제거할까요?"
          description="Workspace 등록만 해제합니다. 실제 폴더와 파일은 삭제되지 않습니다. 세션 기록도 그대로 남습니다."
          detail={confirmDrop}
          confirmLabel="제거"
          onConfirm={() => onConfirmDrop(confirmDrop)}
          onCancel={onCancelDrop}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          tone="danger"
          title="이 세션을 삭제할까요?"
          description={`대화 기록·승인 이력·변경 파일 기록이 모두 지워집니다. 되돌릴 수 없습니다.${
            running.some((session) => session.id === confirmDelete.id)
              ? ' 실행 중이라 먼저 중지됩니다.'
              : ''
          }${deleteError ? `\n\n삭제 중단: ${deleteError}` : ''}`}
          detail={confirmDelete.worktree?.path ?? confirmDelete.title ?? ''}
          confirmLabel="삭제"
          onConfirm={() => onConfirmDelete(confirmDelete.id)}
          onCancel={onCancelDelete}
        />
      )}

      {checkpoint && (
        <Checkpoint
          draft={checkpoint}
          runners={runners}
          agents={agents}
          onClose={onCloseCheckpoint}
          onHandoff={onHandoff}
        />
      )}

      {worktreeSession?.worktree && (
        <WorktreeDialog
          sessionId={worktreeSession.id}
          worktree={worktreeSession.worktree}
          onChanged={onWorktreeChanged}
          onClose={onCloseWorktree}
        />
      )}
    </>
  )
}
