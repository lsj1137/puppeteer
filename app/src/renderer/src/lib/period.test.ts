import { describe, expect, it } from 'vitest'
import { describeRange, fromDateInput, resolveRange, toDateInput } from './period'

/** 2026-08-27 목요일 14:30 (로컬) */
const NOW = new Date(2026, 7, 27, 14, 30).getTime()
const at = (y: number, m: number, d: number, h = 0): number => new Date(y, m - 1, d, h).getTime()

describe('resolveRange', () => {
  it('오늘은 자정부터 다음 자정까지', () => {
    const range = resolveRange('today', NOW)
    expect(range.from).toBe(at(2026, 8, 27))
    expect(range.to).toBe(at(2026, 8, 28))
  })

  it('이번 주는 월요일에서 시작한다', () => {
    const range = resolveRange('thisWeek', NOW)
    // 2026-08-27 은 목요일 → 월요일은 8월 24일
    expect(range.from).toBe(at(2026, 8, 24))
    expect(range.to).toBe(at(2026, 8, 31))
  })

  it('일요일에도 그 주의 월요일을 잡는다', () => {
    // 2026-08-30 은 일요일. 일요일 시작이면 혼자 새 주가 되어 주말 작업이 잘린다.
    const range = resolveRange('thisWeek', at(2026, 8, 30, 20))
    expect(range.from).toBe(at(2026, 8, 24))
  })

  it('월요일 0시는 그 주에 들어간다', () => {
    const range = resolveRange('thisWeek', at(2026, 8, 24))
    expect(range.from).toBe(at(2026, 8, 24))
  })

  it('지난 주는 이번 주 바로 앞에 붙는다', () => {
    const last = resolveRange('lastWeek', NOW)
    const current = resolveRange('thisWeek', NOW)
    expect(last.to).toBe(current.from)
    expect(current.from - last.from).toBe(7 * 86_400_000)
  })

  it('이번 달은 1일부터 다음 달 1일까지', () => {
    const range = resolveRange('thisMonth', NOW)
    expect(range.from).toBe(at(2026, 8, 1))
    expect(range.to).toBe(at(2026, 9, 1))
  })

  it('지난 달은 이번 달 바로 앞에 붙는다', () => {
    const last = resolveRange('lastMonth', NOW)
    expect(last.from).toBe(at(2026, 7, 1))
    expect(last.to).toBe(at(2026, 8, 1))
  })

  it('연초에도 지난 달이 작년 12월로 넘어간다', () => {
    const range = resolveRange('lastMonth', at(2026, 1, 15))
    expect(range.from).toBe(at(2025, 12, 1))
    expect(range.to).toBe(at(2026, 1, 1))
  })

  it('전체는 모든 시각을 담는다', () => {
    const range = resolveRange('all', NOW)
    expect(range.from).toBe(0)
    expect(at(1970, 1, 2)).toBeGreaterThan(range.from)
    expect(range.to).toBeGreaterThan(NOW)
  })

  describe('직접 지정', () => {
    it('끝 날짜는 그날까지 포함한다', () => {
      const range = resolveRange('custom', NOW, { from: at(2026, 8, 3), to: at(2026, 8, 5) })
      expect(range.from).toBe(at(2026, 8, 3))
      // 8월 5일 23:59 도 들어가야 하므로 경계는 8월 6일 0시
      expect(range.to).toBe(at(2026, 8, 6))
    })

    it('시각이 섞여 들어와도 그날 0시로 맞춘다', () => {
      const range = resolveRange('custom', NOW, { from: at(2026, 8, 3, 17), to: at(2026, 8, 3, 9) })
      expect(range.from).toBe(at(2026, 8, 3))
      expect(range.to).toBe(at(2026, 8, 4))
    })

    it('거꾸로 고르면 뒤집어 준다', () => {
      const range = resolveRange('custom', NOW, { from: at(2026, 8, 20), to: at(2026, 8, 10) })
      expect(range.from).toBeLessThan(range.to)
      expect(range.from).toBe(at(2026, 8, 11))
    })

    it('한쪽만 고르면 다른 쪽은 열어 둔다', () => {
      expect(resolveRange('custom', NOW, { from: at(2026, 8, 3) }).from).toBe(at(2026, 8, 3))
      expect(resolveRange('custom', NOW, { to: at(2026, 8, 3) }).from).toBe(0)
    })
  })

  it('구간은 반열림이라 이웃한 날이 겹치지 않는다', () => {
    const today = resolveRange('today', NOW)
    const tomorrow = resolveRange('today', NOW + 86_400_000)
    expect(today.to).toBe(tomorrow.from)
  })
})

describe('toDateInput / fromDateInput', () => {
  it('왕복해도 그날 0시로 돌아온다', () => {
    const value = toDateInput(at(2026, 8, 27, 14))
    expect(value).toBe('2026-08-27')
    expect(fromDateInput(value)).toBe(at(2026, 8, 27))
  })

  it('한 자리 월·일도 0을 채운다', () => {
    expect(toDateInput(at(2026, 1, 5))).toBe('2026-01-05')
  })

  it('형식이 아니면 날짜를 지어내지 않는다', () => {
    expect(fromDateInput('')).toBeUndefined()
    expect(fromDateInput('2026-8-27')).toBeUndefined()
    expect(fromDateInput('어제')).toBeUndefined()
  })
})

describe('describeRange', () => {
  it('하루면 한 날짜만 쓴다', () => {
    expect(describeRange('today', resolveRange('today', NOW))).toBe('8월 27일')
  })

  it('여러 날이면 마지막 날은 경계 하루 전이다', () => {
    expect(describeRange('thisWeek', resolveRange('thisWeek', NOW))).toBe('8월 24일 – 8월 30일')
  })

  it('전체는 날짜를 쓰지 않는다', () => {
    expect(describeRange('all', resolveRange('all', NOW))).toBe('전체 기간')
  })
})
