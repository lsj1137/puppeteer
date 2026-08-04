import { describe, expect, it } from 'vitest'
import { extractMemoryProposals } from './memory-proposal'

describe('memory proposal signal', () => {
  it('extracts a valid proposal and hides its transport block', () => {
    const result = extractMemoryProposals('답변\n```memory-proposal\n{"scope":"project","content":"- pnpm 사용","reason":"반복 규칙"}\n```')
    expect(result.text).toBe('답변')
    expect(result.proposals).toEqual([{ scope: 'project', content: '- pnpm 사용', reason: '반복 규칙' }])
  })

  it('leaves malformed blocks visible', () => {
    const text = '```memory-proposal\n{"scope":"auto"}\n```'
    expect(extractMemoryProposals(text)).toEqual({ text, proposals: [] })
  })

  it('does not accept global memory proposals', () => {
    const text = '```memory-proposal\n{"scope":"global","content":"x","reason":"y"}\n```'
    expect(extractMemoryProposals(text)).toEqual({ text, proposals: [] })
  })
})
