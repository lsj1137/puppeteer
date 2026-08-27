import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent, StoredSession } from '@shared/session'

const events = new Map<string, SessionEvent[]>()
const fileChanges = new Map<string, string[]>()

vi.mock('./db', () => ({
  listEvents: (id: string) => (events.get(id) ?? []).map((event) => ({ event })),
  listFileChanges: (id: string) => fileChanges.get(id) ?? [],
}))

const { buildFacts, buildPrompt } = await import('./report')

const session = (over: Partial<StoredSession> = {}): StoredSession => ({
  id: 's1',
  projectPath: 'C:\\repo\\puppeteer',
  cliSessionId: null,
  runnerId: null,
  title: '세로 모드 구현',
  status: 'completed',
  costUsd: 0.5,
  startedAt: new Date(2026, 7, 27, 10, 0).getTime(),
  endedAt: new Date(2026, 7, 27, 12, 0).getTime(),
  ...over,
})

const message = (role: 'user' | 'assistant', text: string, isError = false): SessionEvent =>
  ({ t: 'message', role, text, isError }) as SessionEvent

beforeEach(() => {
  events.clear()
  fileChanges.clear()
})

describe('buildFacts', () => {
  it('세션이 없으면 없다고 쓴다 — 빈 번들을 주지 않는다', () => {
    const facts = buildFacts([], '8월 24일 – 8월 30일')
    expect(facts.sessionCount).toBe(0)
    expect(facts.text).toContain('세션이 없습니다')
    expect(facts.text).toContain('8월 24일 – 8월 30일')
  })

  it('제목·프로젝트·지시·마지막 보고를 담는다', () => {
    events.set('s1', [
      message('user', '세로 모드 만들어줘\n둘째 줄은 버린다'),
      message('assistant', '세로 배치를 넣었습니다.'),
    ])
    fileChanges.set('s1', ['app/src/App.tsx'])

    const { text } = buildFacts([session()], '8월 27일')

    expect(text).toContain('세로 모드 구현')
    expect(text).toContain('puppeteer')
    expect(text).toContain('세로 모드 만들어줘')
    expect(text).not.toContain('둘째 줄은 버린다')
    expect(text).toContain('세로 배치를 넣었습니다.')
    expect(text).toContain('app/src/App.tsx')
  })

  it('마지막 응답으로 실패한 것을 고르지 않는다', () => {
    events.set('s1', [
      message('assistant', '정상적으로 끝냈습니다.'),
      message('assistant', '알 수 없는 오류', true),
    ])

    const { text } = buildFacts([session()], '8월 27일')

    expect(text).toContain('정상적으로 끝냈습니다.')
    expect(text).not.toContain('알 수 없는 오류')
  })

  it('지시가 많으면 앞의 다섯 개만 남긴다', () => {
    events.set(
      's1',
      Array.from({ length: 9 }, (_, i) => message('user', `지시${i}`)),
    )

    const { text } = buildFacts([session()], '8월 27일')

    expect(text).toContain('지시4')
    expect(text).not.toContain('지시5')
  })

  it('마지막 보고가 길면 잘라서 표시를 남긴다', () => {
    events.set('s1', [message('assistant', 'ㄱ'.repeat(2000))])

    const { text } = buildFacts([session()], '8월 27일')

    expect(text).toContain('…')
    expect(text.length).toBeLessThan(2000)
  })

  it('숨긴 세션도 담되 숨김이라고 밝힌다', () => {
    const { text } = buildFacts([session({ hidden: true })], '8월 27일')
    expect(text).toContain('숨김')
  })

  it('비용을 합산한다', () => {
    const facts = buildFacts(
      [session({ id: 'a', costUsd: 1.5 }), session({ id: 'b', costUsd: 2.25 })],
      '8월 27일',
    )
    expect(facts.totalCostUsd).toBeCloseTo(3.75)
    expect(facts.sessionCount).toBe(2)
  })

  it('최근 세션이 먼저 온다', () => {
    const older = session({ id: 'old', title: '오래된 것', startedAt: 1_000 })
    const newer = session({ id: 'new', title: '최근 것', startedAt: 2_000 })

    const { text } = buildFacts([older, newer], '전체 기간')

    expect(text.indexOf('최근 것')).toBeLessThan(text.indexOf('오래된 것'))
  })

  describe('분량 상한', () => {
    /** 한 건이 상한을 크게 먹도록 긴 응답을 넣는다 */
    const bulky = (id: string, startedAt: number): StoredSession => {
      events.set(id, [message('assistant', 'ㄱ'.repeat(500))])
      return session({ id, title: `세션 ${id}`, startedAt })
    }

    it('상한을 넘으면 오래된 것부터 한 줄로 줄인다', () => {
      const many = Array.from({ length: 400 }, (_, i) => bulky(`s${i}`, 1_000 + i))

      const facts = buildFacts(many, '전체 기간')

      expect(facts.sessionCount).toBe(400)
      expect(facts.trimmedCount).toBeGreaterThan(0)
      // 가장 최근 것은 온전히 남는다
      expect(facts.text).toContain('세션 s399')
      expect(facts.text).toContain('목록만 있는 세션')
    })

    it('무엇이 줄었는지 앞머리에 밝힌다 — 조용히 빠지면 틀린 보고가 된다', () => {
      const many = Array.from({ length: 400 }, (_, i) => bulky(`s${i}`, 1_000 + i))

      const facts = buildFacts(many, '전체 기간')

      expect(facts.text).toContain(`오래된 ${facts.trimmedCount}건은 제목만 남겼습니다`)
    })

    it('적은 건수는 아무것도 줄이지 않는다', () => {
      const few = Array.from({ length: 3 }, (_, i) => bulky(`s${i}`, 1_000 + i))

      const facts = buildFacts(few, '전체 기간')

      expect(facts.trimmedCount).toBe(0)
      expect(facts.text).not.toContain('목록만 있는 세션')
    })
  })
})

describe('buildPrompt', () => {
  it('사용자 요청을 앞에 두고 기록을 뒤에 붙인다', () => {
    const prompt = buildPrompt('주간 보고 써줘', '# 작업 기록\n세션 1건')
    expect(prompt.indexOf('주간 보고 써줘')).toBeLessThan(prompt.indexOf('# 작업 기록'))
  })

  it('지어내지 말고 도구를 쓰지 말라고 못 박는다', () => {
    const prompt = buildPrompt('보고서', '기록')
    expect(prompt).toContain('지어내지 마라')
    expect(prompt).toContain('도구를 쓰지 마라')
  })
})
