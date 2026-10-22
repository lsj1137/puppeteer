/**
 * 사용량 이벤트에서 «턴마다 실제로 쓴 비용» 을 복원한다.
 *
 * 예전 합계는 세션의 `cost_usd` 를 세션 **시작일** 기준으로 더했다. 두 가지가 틀렸다.
 * - 지난주에 시작해 오늘 많이 쓴 세션은 오늘 0 으로 잡혔다.
 * - CLI 의 `total_cost_usd` 는 버전에 따라 뜻이 다르다. 누적값을 그대로 더하면 부풀고,
 *   턴별 값을 증가분처럼 빼면 모자란다. 그래서 이벤트마다 어느 쪽인지 가려 증가분을 만든다.
 *
 * 실측(이 앱의 이벤트 기록, 같은 run 안 연속 두 턴 사이 «감소» 비율):
 * | CLI | 감소 비율 | 뜻 |
 * |---|---|---|
 * | 2.1.220 ~ 2.1.235 | 0.42 ~ 0.71 | 턴별 |
 * | 2.1.278, 2.1.284 | 0.01, 0.00 | 대화 누적 |
 * 그 사이 버전은 기록이 없어 계열 모양으로 가린다.
 *
 * 이벤트는 run 별 계열로 나눈다(Lead 는 세션당 `<세션>:lead` 하나, 보조는 run 마다 새 대화).
 */
export interface UsagePoint {
  /** 같은 CLI 대화를 묶는 키 — 세션 + run */
  key: string
  /** epoch ms */
  at: number
  total: number
  /** 어댑터가 판별한 값. 옛 기록에는 없다. */
  cumulative?: boolean
  /** 그 턴을 돌린 CLI 버전(`session-meta`). */
  cliVersion?: string
}

/** 이 버전부터 누적이 관측됐다. */
export const CUMULATIVE_SINCE = '2.1.278'
/** 이 버전까지 턴별이 관측됐다. */
export const PER_TURN_UNTIL = '2.1.235'
/** 버전을 모를 때: 감소가 이 비율보다 드물면 누적 계열(가끔 새 대화로 리셋)으로 본다. */
const CUMULATIVE_MAX_DECREASE_RATIO = 0.2

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function versionSays(version: string | undefined): boolean | undefined {
  if (!version || !/^\d+(\.\d+)*$/.test(version)) return undefined
  if (compareVersion(version, CUMULATIVE_SINCE) >= 0) return true
  if (compareVersion(version, PER_TURN_UNTIL) <= 0) return false
  return undefined
}

export function perTurnCosts(points: UsagePoint[]): Array<{ at: number; cost: number }> {
  const series = new Map<string, UsagePoint[]>()
  for (const point of points) {
    const list = series.get(point.key)
    if (list) list.push(point)
    else series.set(point.key, [point])
  }

  const out: Array<{ at: number; cost: number }> = []
  for (const list of series.values()) {
    const transitions = list.length - 1
    const decreases = list.filter((point, i) => i > 0 && point.total < list[i - 1].total).length
    const shapeSays = transitions > 0 ? decreases / transitions < CUMULATIVE_MAX_DECREASE_RATIO : true

    // 지금 CLI 대화에서 이미 센 몫. 누적값은 «대화 전체» 라 여기서 뺀 만큼이 이번 턴이다.
    // 업그레이드를 사이에 둔 세션(턴별 몇 번 → 누적)도 앞서 센 턴별 값이 여기 쌓여 있어 두 번 세지 않는다.
    let counted = 0
    for (const point of list) {
      const cumulative = point.cumulative ?? versionSays(point.cliVersion) ?? shapeSays
      let cost: number
      if (!cumulative) {
        cost = point.total
      } else if (point.total >= counted) {
        cost = point.total - counted
      } else {
        // 누적인데 줄었다 → 새 CLI 대화가 시작됐다(이어가기 실패 등). 그 값이 곧 증가분.
        counted = 0
        cost = point.total
      }
      counted += cost
      if (cost > 0) out.push({ at: point.at, cost })
    }
  }
  return out
}

export function sumSince(costs: Array<{ at: number; cost: number }>, from?: number): number {
  return costs.reduce((sum, { at, cost }) => (from === undefined || at >= from ? sum + cost : sum), 0)
}
