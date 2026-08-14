import { describe, expect, it } from 'vitest'
import { nextWorktreeIntegrationStep } from './worktree-integration'

const status = (patch: Partial<Parameters<typeof nextWorktreeIntegrationStep>[1]> = {}) => ({
  dirty: false,
  originDirty: false,
  hasCommits: true,
  merged: false,
  canMerge: true,
  ahead: 1,
  behind: 0,
  currentBranch: 'main',
  baseBranch: 'main',
  ...patch,
})

describe('completed worktree integration policy', () => {
  it('commits dirty work by default before attempting a merge', () => {
    expect(nextWorktreeIntegrationStep('auto', status({ dirty: true, canMerge: false }))).toBe(
      'commit',
    )
    expect(
      nextWorktreeIntegrationStep('auto', status({ dirty: true, merged: true, canMerge: false })),
    ).toBe('commit')
  })

  it('merges only a clean worktree reported as fast-forward safe', () => {
    expect(nextWorktreeIntegrationStep('auto', status())).toBe('merge')
    expect(nextWorktreeIntegrationStep('auto', status({ canMerge: false }))).toBe('suggest')
  })

  it('rebases a private worktree when approved Memory advanced the clean source branch', () => {
    expect(nextWorktreeIntegrationStep('auto', status({ canMerge: false, behind: 1 }))).toBe(
      'rebase',
    )
    expect(
      nextWorktreeIntegrationStep('auto', status({ canMerge: false, behind: 1, originDirty: true })),
    ).toBe('suggest')
  })

  it('never commits or merges in suggestion mode', () => {
    expect(nextWorktreeIntegrationStep('suggest', status({ dirty: true }))).toBe('suggest')
    expect(nextWorktreeIntegrationStep('suggest', status({ dirty: true, merged: true }))).toBe(
      'suggest',
    )
    expect(nextWorktreeIntegrationStep('suggest', status())).toBe('suggest')
  })

  it('does nothing when worktree integration is disabled', () => {
    expect(nextWorktreeIntegrationStep('off', status({ dirty: true }))).toBe('none')
  })

  it('does nothing when there is no work or it was already merged', () => {
    expect(
      nextWorktreeIntegrationStep('auto', status({ hasCommits: false, canMerge: false })),
    ).toBe('none')
    expect(nextWorktreeIntegrationStep('suggest', status({ merged: true }))).toBe('none')
  })
})
