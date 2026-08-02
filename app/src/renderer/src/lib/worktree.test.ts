import { describe, expect, it } from 'vitest'
import type { WorktreeStatus } from '@shared/session'
import { shouldShowWorktreeRebase } from './worktree'

const status = (patch: Partial<WorktreeStatus> = {}): WorktreeStatus => ({
  worktree: { path: '/worktree', branch: 'puppeteer/test', origin: '/project' },
  dirty: false,
  originDirty: false,
  hasCommits: true,
  ahead: 1,
  behind: 1,
  merged: false,
  canMerge: false,
  ...patch,
})

describe('worktree rebase action', () => {
  it('shows for an unmerged branch behind the original branch', () => {
    expect(shouldShowWorktreeRebase(status(), false, false)).toBe(true)
  })

  it('stays hidden after the branch commits have already been merged', () => {
    expect(shouldShowWorktreeRebase(status({ merged: true, ahead: 0 }), false, false)).toBe(false)
  })
})
