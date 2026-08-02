/** 새 세션은 기본 격리하되, 기존 대화의 작업 위치는 중간에 바꾸지 않는다. */
export function shouldCreateWorktree(requested: boolean | undefined, isContinuation: boolean): boolean {
  return !isContinuation && requested !== false
}

export function sessionDeletionBlockReason(
  dirty: boolean | undefined,
  status: { hasCommits: boolean; merged: boolean; reason?: string },
): string | undefined {
  if (dirty === undefined || status.reason?.includes('상태를 읽지 못했습니다')) {
    return 'worktree 상태를 확인하지 못해 세션 삭제를 중단했습니다.'
  }
  if (dirty) {
    return 'worktree에 커밋되지 않은 변경이 있습니다. Worktree 관리에서 먼저 커밋해 주세요.'
  }
  if (status.hasCommits && !status.merged) {
    return '원본에 병합하지 않은 worktree 커밋이 있습니다. 먼저 병합하거나 worktree를 정리해 주세요.'
  }
  return undefined
}
