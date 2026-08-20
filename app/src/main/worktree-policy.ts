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

/**
 * 세션을 지울 때 worktree 안전 검사를 해야 하는지.
 *
 * 폴더가 이미 없으면 잃을 작업이 없고, 원본을 확인할 수 없으면 검사 자체가 불가능하다.
 * 두 경우 모두 검사를 건너뛰고 DB 연결만 끊어야 한다 — 예전에는 여기서 «상태를 확인하지
 * 못했습니다» 로 막혀 폴더가 사라진 오래된 세션을 영영 지우지 못했다.
 */
export function needsWorktreeSafetyCheck(
  connection: 'connected' | 'detached' | 'unavailable',
): boolean {
  return connection === 'connected'
}

/**
 * worktree 폴더 정리를 막아야 하는 이유.
 *
 * Git 이 거부하면 «contains modified or untracked files» 같은 영어 원문만 남는다.
 * 무엇을 어떻게 해야 풀리는지는 우리가 안다 — 원문 대신 다음 행동을 알려준다.
 * 세션 삭제(`sessionDeletionBlockReason`)와 달리 여기서는 폴더만 지우므로 기록은 남는다.
 */
export function worktreeCleanupBlockReason(
  dirty: boolean | undefined,
  status: { hasCommits: boolean; merged: boolean },
): string | undefined {
  if (dirty === undefined) {
    return 'worktree 상태를 읽지 못했습니다. 폴더가 열려 있거나 다른 Git 작업이 도는지 확인해 주세요.'
  }
  if (dirty) {
    return '커밋되지 않은 변경이 있어 폴더를 지우지 않았습니다. 위에서 먼저 커밋하거나, 버려도 되는 변경이면 직접 삭제해 주세요.'
  }
  if (status.hasCommits && !status.merged) {
    return '원본에 병합하지 않은 커밋이 있어 폴더를 지우지 않았습니다. 먼저 «원본에 반영»을 실행해 주세요.'
  }
  return undefined
}
