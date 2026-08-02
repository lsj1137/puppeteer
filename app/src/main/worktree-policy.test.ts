import { describe, expect, it } from 'vitest'
import {
  sessionDeletionBlockReason,
  shouldCreateWorktree,
  worktreeBranchName,
} from './worktree-policy'

describe('worktree launch policy', () => {
  it('isolates a new session by default', () => {
    expect(shouldCreateWorktree(undefined, false)).toBe(true)
  })

  it('honors an explicit isolation request', () => {
    expect(shouldCreateWorktree(true, false)).toBe(true)
  })

  it('allows a new session to use the current folder explicitly', () => {
    expect(shouldCreateWorktree(false, false)).toBe(false)
  })

  it('keeps the original working directory when continuing a session', () => {
    expect(shouldCreateWorktree(undefined, true)).toBe(false)
    expect(shouldCreateWorktree(true, true)).toBe(false)
  })

  it('creates a fresh worktree when continuing a cleaned isolated session', () => {
    expect(shouldCreateWorktree(undefined, true, true)).toBe(true)
    expect(shouldCreateWorktree(false, true, true)).toBe(true)
  })

  it('uses a unique branch name when recreating a cleaned worktree', () => {
    expect(worktreeBranchName('12345678-abcd')).toBe('puppeteer/12345678')
    expect(worktreeBranchName('12345678-abcd', 123456)).toBe('puppeteer/12345678-2n9c')
  })
})

describe('worktree session deletion policy', () => {
  it('blocks deletion when worktree state is unknown', () => {
    expect(sessionDeletionBlockReason(undefined, { hasCommits: false, merged: false })).toContain('확인하지 못')
  })

  it('blocks deletion when uncommitted work remains', () => {
    expect(sessionDeletionBlockReason(true, { hasCommits: false, merged: false })).toContain('커밋되지 않은')
  })

  it('blocks deletion when commits have not been merged', () => {
    expect(sessionDeletionBlockReason(false, { hasCommits: true, merged: false })).toContain('병합하지 않은')
  })

  it('allows clean untouched or merged worktrees to be removed', () => {
    expect(sessionDeletionBlockReason(false, { hasCommits: false, merged: false })).toBeUndefined()
    expect(sessionDeletionBlockReason(false, { hasCommits: true, merged: true })).toBeUndefined()
  })
})
