import { describe, expect, it } from 'vitest'
import { isCumulativeCost, rateWindow } from './adapters/claude-cli'
import { perTurnCosts, sumSince } from './cost-ledger'

describe('perTurnCosts', () => {
  it('누적값 계열은 증가분만 센다(2026-09 이후 CLI)', () => {
    // 실제 세션 06bfe3ef 의 앞부분 값
    const costs = perTurnCosts([
      { key: 's:lead', at: 1, total: 1.212 },
      { key: 's:lead', at: 2, total: 3.477 },
      { key: 's:lead', at: 3, total: 3.811 },
    ])
    expect(costs.map((c) => Number(c.cost.toFixed(3)))).toEqual([1.212, 2.265, 0.334])
    expect(Number(sumSince(costs).toFixed(3))).toBe(3.811)
  })

  it('CLI 2.1.235 이하는 턴별 값으로 본다(값이 올라도 그대로 더한다)', () => {
    const costs = perTurnCosts([
      { key: 's:lead', at: 1, total: 1.5489, cliVersion: '2.1.235' },
      { key: 's:lead', at: 2, total: 1.2913, cliVersion: '2.1.235' },
      { key: 's:lead', at: 3, total: 3.6078, cliVersion: '2.1.235' },
    ])
    expect(Number(sumSince(costs).toFixed(4))).toBe(6.448)
  })

  it('버전을 모르면 계열 모양으로 가린다 — 감소가 드물면 누적(한 번의 감소는 새 대화로 본다)', () => {
    const points = [1, 2, 3, 4, 5, 6, 0.5, 1.5].map((total, i) => ({ key: 's:lead', at: i, total }))
    expect(sumSince(perTurnCosts(points))).toBeCloseTo(6 + 1.5)
    // 실제 2026-08 계열처럼 자주 오르내리면 턴별
    const perTurn = [1, 0.5, 2, 1, 3].map((total, i) => ({ key: 's:lead', at: i, total }))
    expect(sumSince(perTurnCosts(perTurn))).toBeCloseTo(7.5)
  })

  it('업그레이드를 사이에 둔 세션은 앞서 센 턴별 값을 빼고 누적분만 더한다', () => {
    const costs = perTurnCosts([
      { key: 's:lead', at: 1, total: 1, cliVersion: '2.1.235' },
      { key: 's:lead', at: 2, total: 0.5, cliVersion: '2.1.235' },
      // 새 CLI 는 이어간 대화 전체(1 + 0.5 + 이번 턴 0.7)를 준다
      { key: 's:lead', at: 3, total: 2.2, cliVersion: '2.1.284' },
    ])
    expect(costs.map((c) => Number(c.cost.toFixed(2)))).toEqual([1, 0.5, 0.7])
  })

  it('어댑터가 누적이라고 표시하면 그대로 따르고, 누적인데 줄면 새 대화로 본다', () => {
    const costs = perTurnCosts([
      { key: 's:lead', at: 1, total: 2 },
      { key: 's:lead', at: 2, total: 2.5, cumulative: true },
      { key: 's:lead', at: 3, total: 0.4, cumulative: true },
    ])
    expect(costs.map((c) => c.cost)).toEqual([2, 0.5, 0.4])
  })

  it('보조 run 은 따로 센다. 기간은 턴이 끝난 시각 기준이다', () => {
    const costs = perTurnCosts([
      { key: 's:lead', at: 10, total: 1 },
      { key: 's:sub:a', at: 20, total: 0.3 },
      { key: 's:lead', at: 30, total: 1.5 },
    ])
    // 세션은 10 에 시작했지만 15 이후에 쓴 몫만 잡힌다.
    expect(sumSince(costs, 15)).toBeCloseTo(0.8)
  })
})

// 2026-10-22 실측(CLI 2.1.284, haiku): 같은 대화를 이어간 두 번째 턴의 결과
describe('CLI 결과 해석', () => {
  it('modelUsage(누적) 토큰이 usage(이번 턴) 보다 크면 비용도 누적값이다', () => {
    const usage = { input_tokens: 9, output_tokens: 42 }
    const modelUsage = { 'claude-haiku-4-5': { inputTokens: 18, outputTokens: 152 } }
    expect(isCumulativeCost(usage, modelUsage)).toBe(true)
  })

  it('첫 턴처럼 둘이 같으면 판별하지 않는다', () => {
    expect(isCumulativeCost({ input_tokens: 9, output_tokens: 110 }, { m: { inputTokens: 9, outputTokens: 110 } })).toBeUndefined()
    expect(isCumulativeCost({ input_tokens: 9 }, undefined)).toBeUndefined()
  })

  it('rate_limit_event 의 unifiedWindows 에서 실제 사용률을 읽는다', () => {
    expect(rateWindow({ utilization: 0.61, resetsAt: 1792681200 })).toEqual({ utilization: 0.61, resetsAt: 1792681200 })
    expect(rateWindow(undefined)).toBeUndefined()
    expect(rateWindow({ resetsAt: 1 })).toBeUndefined()
  })
})
