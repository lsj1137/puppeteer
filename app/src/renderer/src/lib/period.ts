/** Overview 세션 목록을 거를 기간. */
export type PeriodPreset =
  | 'today'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'all'
  | 'custom'

export interface PeriodRange {
  /** 이 시각부터 (포함) */
  from: number
  /** 이 시각 전까지 (제외) */
  to: number
}

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  today: '오늘',
  thisWeek: '이번 주',
  lastWeek: '지난 주',
  thisMonth: '이번 달',
  lastMonth: '지난 달',
  all: '전체',
  custom: '직접 지정',
}

const DAY = 86_400_000

const startOfDay = (at: number): number => {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 주의 시작은 **월요일**이다. 업무 주간이 기준이라 일요일 시작이면 주말 작업이
 * 다음 주로 넘어간다.
 */
const startOfWeek = (at: number): number => {
  const d = new Date(startOfDay(at))
  // getDay(): 일=0 … 토=6. 월요일까지 되돌릴 일수로 바꾼다.
  const back = (d.getDay() + 6) % 7
  return d.getTime() - back * DAY
}

const startOfMonth = (at: number): number => {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

const addMonths = (at: number, months: number): number => {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth() + months, 1).getTime()
}

/**
 * 프리셋을 실제 구간으로 바꾼다.
 *
 * `now` 를 인자로 받는다 — 안에서 `Date.now()` 를 부르면 테스트할 수 없고,
 * 자정을 넘기는 순간 같은 화면이 다른 답을 낸다.
 *
 * 구간은 **반열림**(`from ≤ t < to`)이다. 닫힌 구간으로 두면 자정에 시작한
 * 세션이 이틀 모두에 걸린다.
 */
export function resolveRange(
  preset: PeriodPreset,
  now: number,
  custom?: { from?: number; to?: number },
): PeriodRange {
  switch (preset) {
    case 'today': {
      const from = startOfDay(now)
      return { from, to: from + DAY }
    }
    case 'thisWeek': {
      const from = startOfWeek(now)
      return { from, to: from + 7 * DAY }
    }
    case 'lastWeek': {
      const to = startOfWeek(now)
      return { from: to - 7 * DAY, to }
    }
    case 'thisMonth': {
      const from = startOfMonth(now)
      return { from, to: addMonths(from, 1) }
    }
    case 'lastMonth': {
      const to = startOfMonth(now)
      return { from: addMonths(to, -1), to }
    }
    case 'custom': {
      // 끝 날짜는 «그날까지 포함» 이 자연스럽다. 하루를 더해 반열림으로 맞춘다.
      const from = custom?.from !== undefined ? startOfDay(custom.from) : 0
      const to = custom?.to !== undefined ? startOfDay(custom.to) + DAY : Number.MAX_SAFE_INTEGER
      // 거꾸로 고른 경우 빈 구간을 주는 대신 뒤집어 준다
      return from <= to ? { from, to } : { from: to, to: from }
    }
    case 'all':
    default:
      return { from: 0, to: Number.MAX_SAFE_INTEGER }
  }
}

/** `<input type="date">` 가 쓰는 `YYYY-MM-DD`. 로컬 날짜 기준이다. */
export function toDateInput(at: number): string {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `YYYY-MM-DD` 를 그날 0시로. 형식이 아니면 `undefined` — 지어내지 않는다. */
export function fromDateInput(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [, year, month, day] = match
  const at = new Date(Number(year), Number(month) - 1, Number(day)).getTime()
  return Number.isNaN(at) ? undefined : at
}

/** 고른 구간을 사람이 읽을 한 줄로. */
export function describeRange(preset: PeriodPreset, range: PeriodRange): string {
  if (preset === 'all') return '전체 기간'
  const from = new Date(range.from)
  // 반열림이므로 마지막 날은 `to` 하루 전이다
  const last = new Date(range.to - 1)
  const fmt = (d: Date): string => `${d.getMonth() + 1}월 ${d.getDate()}일`
  return from.toDateString() === last.toDateString() ? fmt(from) : `${fmt(from)} – ${fmt(last)}`
}
