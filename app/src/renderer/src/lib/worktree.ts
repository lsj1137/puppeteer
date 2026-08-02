import type { WorktreeStatus } from '@shared/session'

export function shouldShowWorktreeRebase(
  status: WorktreeStatus | undefined,
  hasConflict: boolean,
  running: boolean,
): boolean {
  return Boolean(
    status &&
      !status.merged &&
      status.behind > 0 &&
      status.hasCommits &&
      !hasConflict &&
      !status.dirty &&
      !status.originDirty &&
      !running,
  )
}
