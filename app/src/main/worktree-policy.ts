/** 새 세션은 기본 격리하고, 정리된 격리 세션은 재개할 때 새 worktree를 만든다. */
export function shouldCreateWorktree(
  requested: boolean | undefined,
  isContinuation: boolean,
  worktreeCleaned = false,
): boolean {
  return worktreeCleaned || (!isContinuation && requested !== false)
}

/** 정리 후 재생성하는 브랜치는 이전에 남은 브랜치와 겹치지 않아야 한다. */
export function worktreeBranchName(sessionId: string, recreatedAt?: number): string {
  const base = `puppeteer/${sessionId.slice(0, 8)}`
  return recreatedAt === undefined ? base : `${base}-${recreatedAt.toString(36)}`
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
