import type { RateLimitInfo, RateLimitWindow } from '@shared/session'

/** 화면에 그릴 한도 창 하나 */
export interface LimitRow {
  key: 'fiveHour' | 'sevenDay'
  label: string
  /** 0~1, 실제 사용률 */
  ratio: number
  /** 리셋까지 남은 시간. 이미 지났으면 «초기화됨» */
  remain: string
}

function remainText(ms: number): string {
  const totalMin = Math.floor(ms / 60_000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}일 ${h}시간`
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

function row(key: LimitRow['key'], label: string, window: RateLimitWindow | undefined, now: number): LimitRow | undefined {
  if (!window) return undefined
  const left = window.resetsAt * 1000 - now
  // 리셋이 지났으면 그 창의 사용량은 다시 0 에서 시작한다. 묵은 값을 그대로 보여주지 않는다.
  if (left <= 0) return { key, label, ratio: 0, remain: '초기화됨' }
  return { key, label, ratio: Math.min(1, Math.max(0, window.utilization)), remain: remainText(left) }
}

/** CLI 가 준 창별 실제 사용률. 예전처럼 «창이 얼마나 지났나» 를 사용량으로 보여주지 않는다. */
export function limitRows(info: RateLimitInfo | undefined, now: number): LimitRow[] {
  return [row('fiveHour', '5시간', info?.fiveHour, now), row('sevenDay', '주간', info?.sevenDay, now)].filter(
    (r): r is LimitRow => !!r,
  )
}

/** 접힌 막대 하나로 보여줄 창 — 더 많이 찬 쪽이 먼저 막힌다. */
export function bindingRow(rows: LimitRow[]): LimitRow | undefined {
  return rows.reduce<LimitRow | undefined>((best, r) => (!best || r.ratio > best.ratio ? r : best), undefined)
}

/** 한도 값이 얼마나 묵었는지. 세션이 돌 때만 갱신된다. */
export function staleText(receivedAt: number | undefined, now: number): string | undefined {
  if (!receivedAt) return undefined
  const min = Math.floor((now - receivedAt) / 60_000)
  if (min < 1) return '방금 기준'
  if (min < 60) return `${min}분 전 기준`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}시간 전 기준` : `${Math.floor(h / 24)}일 전 기준`
}
