import { describe, expect, it } from 'vitest'
import { proposalReviewIndex } from './memory-review'

const proposals = [
  { id: 10, entryId: 'file:D:/a/AGENTS.md' },
  { id: 11, entryId: 'file:D:/b/AGENTS.md' },
  { id: 12, entryId: 'file:D:/a/AGENTS.md' },
  { id: 13, entryId: 'file:D:/a/AGENTS.md' },
]

describe('proposalReviewIndex', () => {
  it('같은 Memory 안에서의 순번을 센다 — 다른 Memory 의 제안은 세지 않는다', () => {
    expect(proposalReviewIndex(proposals, proposals[0])).toBe(0)
    expect(proposalReviewIndex(proposals, proposals[2])).toBe(1)
    expect(proposalReviewIndex(proposals, proposals[3])).toBe(2)
  })

  it('다른 Memory 의 첫 제안은 0 이다', () => {
    expect(proposalReviewIndex(proposals, proposals[1])).toBe(0)
  })

  // 목록이 뒤에서 갱신돼 사라진 제안을 누른 경우
  it('목록에 없으면 첫 번째로 둔다', () => {
    expect(proposalReviewIndex(proposals, { id: 99, entryId: 'file:D:/a/AGENTS.md' })).toBe(0)
  })
})
