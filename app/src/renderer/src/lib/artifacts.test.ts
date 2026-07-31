import { describe, expect, it } from 'vitest'
import { toUiArtifactKind } from './artifacts'

describe('toUiArtifactKind', () => {
  it('preserves UI-supported artifact kinds', () => {
    expect(toUiArtifactKind('code')).toBe('code')
    expect(toUiArtifactKind('md')).toBe('md')
    expect(toUiArtifactKind('diff')).toBe('diff')
    expect(toUiArtifactKind('log')).toBe('log')
  })

  it('falls back image artifacts until the panel has an image view', () => {
    expect(toUiArtifactKind('image')).toBe('log')
  })
})
