import { describe, expect, it } from 'vitest'
import { COLLAPSE_LINES, isLongInput, lineTotal } from './collapse'

describe('isLongInput', () => {
  const lines = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')

  it('folds only past the line limit', () => {
    expect(isLongInput(lines(COLLAPSE_LINES))).toBe(false)
    expect(isLongInput(lines(COLLAPSE_LINES + 1))).toBe(true)
  })

  it('counts lines, not characters', () => {
    expect(lineTotal('')).toBe(0)
    expect(lineTotal('a'.repeat(10_000))).toBe(1)
    expect(lineTotal('a\nb\n')).toBe(3)
  })
})
