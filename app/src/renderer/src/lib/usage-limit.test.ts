import { describe, expect, it } from 'vitest'
import { bindingRow, limitRows, staleText } from './usage-limit'

const H = 3_600_000

describe('limitRows', () => {
  const now = 1_792_620_000_000
  const info = {
    status: 'allowed',
    rateLimitType: 'five_hour',
    resetsAt: 0,
    fiveHour: { utilization: 0.3, resetsAt: now / 1000 + 2 * 3600 + 15 * 60 },
    sevenDay: { utilization: 0.61, resetsAt: now / 1000 + 3 * 86400 + 4 * 3600 },
  }

  it('창이 얼마나 지났는지가 아니라 CLI 가 준 실제 사용률을 쓴다', () => {
    expect(limitRows(info, now)).toEqual([
      { key: 'fiveHour', label: '5시간', ratio: 0.3, remain: '2시간 15분' },
      { key: 'sevenDay', label: '주간', ratio: 0.61, remain: '3일 4시간' },
    ])
  })

  it('접힌 막대는 더 많이 찬 창을 보여준다', () => {
    expect(bindingRow(limitRows(info, now))?.key).toBe('sevenDay')
  })

  it('리셋이 지난 창은 0% 로 초기화한다', () => {
    expect(limitRows(info, now + 3 * H)[0]).toEqual({ key: 'fiveHour', label: '5시간', ratio: 0, remain: '초기화됨' })
  })

  it('사용률이 없는 옛 기록이면 지어내지 않고 비운다', () => {
    expect(limitRows({ status: 'allowed', rateLimitType: 'five_hour', resetsAt: now / 1000 + 60 }, now)).toEqual([])
  })

  it('값이 얼마나 묵었는지 알려준다', () => {
    expect(staleText(now - 5 * 60_000, now)).toBe('5분 전 기준')
    expect(staleText(now - 26 * H, now)).toBe('1일 전 기준')
  })
})
