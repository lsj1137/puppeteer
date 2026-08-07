import type { WorktreeIntegrationMode, WorktreeStatus } from '@shared/session'

export type WorktreeIntegrationStep = 'none' | 'commit' | 'rebase' | 'merge' | 'suggest'

/**
 * 완료된 worktree의 다음 안전한 처리 한 단계.
 * Git 명령 자체와 분리해 기본값·충돌 폴백을 단위 테스트할 수 있게 한다.
 */
export function nextWorktreeIntegrationStep(
  mode: WorktreeIntegrationMode,
  status: Pick<
    WorktreeStatus,
    'dirty' | 'originDirty' | 'hasCommits' | 'merged' | 'canMerge' | 'ahead' | 'behind' | 'currentBranch' | 'baseBranch'
  >,
): WorktreeIntegrationStep {
  // HEAD가 이미 원본에 포함됐더라도 그 뒤 생긴 working tree 변경은 새 작업이다.
  // merged를 먼저 보면 이 변경을 "이미 반영됨"으로 잘못 건너뛴다.
  if (!status.dirty && (status.merged || !status.hasCommits)) return 'none'
  if (mode === 'suggest') return 'suggest'
  if (status.dirty) return 'commit'
  if (
    status.hasCommits
    && !status.merged
    && !status.originDirty
    && status.ahead > 0
    && status.behind > 0
    && status.currentBranch === status.baseBranch
  ) return 'rebase'
  return status.canMerge ? 'merge' : 'suggest'
}
