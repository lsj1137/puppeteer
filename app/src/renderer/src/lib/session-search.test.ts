import { describe, expect, it } from 'vitest'
import type { StoredProject, StoredSession } from '@shared/session'
import { orderForSearch, searchHint } from './session-search'

const s = (id: string, projectPath: string, startedAt: number, hidden = false): StoredSession =>
  ({ id, projectPath, startedAt, hidden, title: id, status: 'completed', costUsd: 0 }) as unknown as StoredSession

describe('orderForSearch', () => {
  it('지금 프로젝트 → 다른 프로젝트(최근 순) → 숨긴 세션 순이다', () => {
    const ordered = orderForSearch(
      [s('old-other', 'B', 1), s('hidden-here', 'A', 9, true), s('here', 'A', 2), s('new-other', 'B', 5)],
      'A',
    )
    expect(ordered.map((x) => x.id)).toEqual(['here', 'new-other', 'old-other', 'hidden-here'])
  })
})

describe('searchHint', () => {
  const projects = [{ path: 'C:\\work\\puppeteer', alias: '퍼펫' }] as unknown as StoredProject[]

  it('다른 프로젝트면 프로젝트 이름(별칭 우선)을, 숨긴 세션이면 «숨김» 을 붙인다', () => {
    expect(searchHint(s('a', 'C:\\work\\puppeteer', 1, true), projects, 'D:\\other', '어제')).toBe('퍼펫 · 숨김 · 어제')
    expect(searchHint(s('b', 'D:\\kcc\\people', 1), projects, 'C:\\work\\puppeteer', '방금')).toBe('people · 방금')
  })

  it('지금 프로젝트의 보이는 세션은 시간만 보인다', () => {
    expect(searchHint(s('c', 'A', 1), [], 'A', '방금')).toBe('방금')
  })
})
