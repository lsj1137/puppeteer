import { describe, expect, it } from 'vitest'
import { shouldCreateWorktree } from './worktree-policy'

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
})
