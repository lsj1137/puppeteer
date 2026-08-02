import { describe, expect, it } from 'vitest'
import { buildResolved, diffBlocks } from './WorktreeConflictResolver'

describe('worktree conflict text diff', () => {
  it('combines selected change blocks from both sides', () => {
    const origin = 'same\norigin one\nmiddle\norigin two\n'
    const worktree = 'same\nworktree one\nmiddle\nworktree two\n'
    const blocks = diffBlocks(origin, worktree)
    const changes = blocks.filter((block) => block.kind === 'change')

    expect(changes).toHaveLength(2)
    expect(
      buildResolved(
        blocks,
        { [changes[0].id]: 'origin', [changes[1].id]: 'worktree' },
        origin,
        worktree,
      ),
    ).toBe('same\norigin one\nmiddle\nworktree two\n')
  })

  it('preserves the selected side final-newline state', () => {
    const origin = 'origin'
    const worktree = 'worktree\n'
    const blocks = diffBlocks(origin, worktree)
    const change = blocks.find((block) => block.kind === 'change')
    if (!change || change.kind !== 'change') throw new Error('change block missing')

    expect(buildResolved(blocks, { [change.id]: 'origin' }, origin, worktree)).toBe('origin')
    expect(buildResolved(blocks, { [change.id]: 'worktree' }, origin, worktree)).toBe('worktree\n')
  })

  it('collapses a very large divergent middle into one bounded change block', () => {
    const origin = ['same start', ...Array.from({ length: 2_000 }, (_, i) => `origin ${i}`), 'same end'].join('\n')
    const worktree = ['same start', ...Array.from({ length: 2_000 }, (_, i) => `worktree ${i}`), 'same end'].join('\n')

    const blocks = diffBlocks(origin, worktree)

    expect(blocks).toHaveLength(3)
    expect(blocks[1]).toMatchObject({ kind: 'change', originLines: { length: 2_000 }, worktreeLines: { length: 2_000 } })
  })
})
