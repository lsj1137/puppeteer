import { describe, expect, it } from 'vitest'
import {
  needsWorktreeSafetyCheck,
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

describe('세션 삭제 시 worktree 안전 검사 범위', () => {
  it('연결이 살아 있을 때만 미커밋·미병합을 확인한다', () => {
    expect(needsWorktreeSafetyCheck('connected')).toBe(true)
  })

  // 폴더가 사라졌으면 잃을 작업이 없다. 여기서 막으면 세션을 영영 못 지운다.
  it('폴더가 사라졌으면 검사하지 않는다', () => {
    expect(needsWorktreeSafetyCheck('detached')).toBe(false)
  })

  // 원본을 못 읽으면 검사 자체가 불가능하다. 폴더는 남기고 연결만 끊는다.
  it('원본을 확인할 수 없으면 검사하지 않는다', () => {
    expect(needsWorktreeSafetyCheck('unavailable')).toBe(false)
  })

  it('상태를 못 읽으면 여전히 삭제를 막는다 — 연결이 살아 있는 경우', () => {
    expect(sessionDeletionBlockReason(undefined, { hasCommits: false, merged: false })).toContain(
      '확인하지 못해',
    )
  })
})
