import type { WorktreeIntegrationMode, WorktreeStatus } from '@shared/session'

export type WorktreeIntegrationStep = 'none' | 'commit' | 'merge' | 'suggest'

/**
 * 완료된 worktree의 다음 안전한 처리 한 단계.
 * Git 명령 자체와 분리해 기본값·충돌 폴백을 단위 테스트할 수 있게 한다.
 */
export function nextWorktreeIntegrationStep(
  mode: WorktreeIntegrationMode,
  status: Pick<WorktreeStatus, 'dirty' | 'hasCommits' | 'merged' | 'canMerge'>,
): WorktreeIntegrationStep {
  if (status.merged || (!status.dirty && !status.hasCommits)) return 'none'
  if (mode === 'suggest') return 'suggest'
  if (status.dirty) return 'commit'
  return status.canMerge ? 'merge' : 'suggest'
}
