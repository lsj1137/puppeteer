import { useState } from 'react'
import { ChevronDown, ChevronUp, Gauge } from 'lucide-react'
import type { CostTotals } from '@shared/session'
import { formatTokens } from '../lib/session-view'
import { bindingRow, type LimitRow } from '../lib/usage-limit'

interface Props {
  /** 레일이 접힘 — 퍼센트만 세로로 보여주고 누르면 레일을 펼친다 */
  collapsed?: boolean
  cost: CostTotals
  /** 창별 실제 사용률(5시간·주간). 받은 적이 없으면 비어 있다. */
  limits: LimitRow[]
  /** 한도 값이 얼마나 묵었는지 — 세션이 돌 때만 갱신된다 */
  stale?: string
  sessionCost: number
  sessionTokens: number
  onExpandRail?: () => void
}

/**
 * 레일 바닥에 붙는다. 레일 전체가 스크롤 영역이라 그냥 두면 프로젝트 목록 끝으로 밀려
 * 같이 스크롤된다. `sticky bottom-0` 로 바닥에 고정하고 목록이 그 **아래로** 지나가게
 * 배경을 채우고 z-index 를 올린다. 음수 하단 여백은 레일 아래쪽 padding 까지 덮어 그 틈으로
 * 목록이 비치지 않게 한다.
 */
const STICKY = 'sticky bottom-0 z-10 mt-auto bg-mantle'

const barColor = (ratio: number): string => (ratio > 0.85 ? 'bg-peach' : 'bg-green')

export default function UsageSummary({
  collapsed,
  cost,
  limits,
  stale,
  sessionCost,
  sessionTokens,
  onExpandRail,
}: Props) {
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem('ws.usageExpanded') === 'true',
  )
  const primary = bindingRow(limits)
  const percent = primary ? Math.round(primary.ratio * 100) : undefined
  const toggle = (): void => {
    setExpanded((current) => {
      localStorage.setItem('ws.usageExpanded', String(!current))
      return !current
    })
  }
  const summaryTitle =
    limits.length === 0
      ? '사용량 — 아직 받은 한도 정보가 없습니다'
      : limits.map((r) => `${r.label} ${Math.round(r.ratio * 100)}% · ${r.remain}`).join('\n')

  if (collapsed) {
    return (
      <div className={`${STICKY} -mb-2.5 w-full pb-2.5`}>
        <button
          type="button"
          onClick={onExpandRail}
          title={summaryTitle}
          aria-label="사용량 펼쳐서 보기"
          className="flex w-full flex-col items-center gap-1 rounded-md pt-2.5 text-overlay1 hover:text-text"
        >
          <Gauge className="h-3.5 w-3.5" />
          <span className="flex h-10 w-1.5 flex-col justify-end overflow-hidden rounded-full bg-surface0">
            <span
              className={`block w-full rounded-full transition-all ${barColor(primary?.ratio ?? 0)}`}
              style={{ height: `${percent ?? 0}%` }}
            />
          </span>
          <span className="font-mono text-[9px] tabular-nums text-subtext1">
            {percent === undefined ? '--' : percent}
          </span>
        </button>
      </div>
    )
  }

  if (!expanded) {
    return (
      <section className={`${STICKY} -mb-2.5 border-t border-surface0 px-1 pb-2.5 pt-2.5`}>
        <button
          type="button"
          aria-expanded={false}
          onClick={toggle}
          title={summaryTitle}
          className="group grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded px-0.5 py-1 hover:bg-surface0/50"
        >
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-overlay1 group-hover:text-text">
            <Gauge className="h-3.5 w-3.5" /> {primary ? primary.label : '사용량'}
          </span>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface0">
            <div
              className={`h-full rounded-full transition-all ${barColor(primary?.ratio ?? 0)}`}
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-subtext1">
            {percent === undefined ? '--%' : `${percent}%`}
          </span>
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-overlay1 group-hover:text-text" />
        </button>
      </section>
    )
  }

  return (
    <section className={`${STICKY} -mb-2.5 space-y-1.5 border-t border-surface0 px-1 pb-2.5 pt-2.5`}>
      <button
        type="button"
        aria-expanded={true}
        onClick={toggle}
        title="사용량 접기"
        className="flex w-full items-center gap-1.5 rounded py-0.5 text-[11px] font-medium uppercase tracking-wider text-overlay1 hover:text-text"
      >
        <Gauge className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">사용량</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {limits.map((limit) => {
        const p = Math.round(limit.ratio * 100)
        return (
          <div key={limit.key} className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[11px] text-overlay1">{limit.label}</span>
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface0">
                <div className={`h-full rounded-full transition-all ${barColor(limit.ratio)}`} style={{ width: `${p}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-subtext1">{p}%</span>
            </div>
            <div className="text-right text-[10px] text-overlay0">
              {limit.remain === '초기화됨' ? '초기화됨' : `${limit.remain} 후 초기화`}
            </div>
          </div>
        )
      })}
      {limits.length > 0 && stale && <div className="text-[10px] text-overlay0">{stale}</div>}
      {limits.length === 0 && (
        <div className="text-[11px] text-overlay1">Claude 세션을 한 번 실행하면 한도 사용률이 표시됩니다.</div>
      )}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-overlay1">오늘</span>
        <span className="font-mono tabular-nums text-subtext1">${cost.today.toFixed(3)}</span>
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-overlay1">이번 달</span>
        <span className="font-mono tabular-nums text-subtext1">${cost.month.toFixed(2)}</span>
      </div>
      {(sessionCost > 0 || sessionTokens > 0) && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-overlay1">현재 세션</span>
          <span
            className="font-mono tabular-nums text-text"
            title={`${sessionTokens.toLocaleString()} 토큰`}
          >
            {sessionCost > 0 ? `$${sessionCost.toFixed(4)}` : `${formatTokens(sessionTokens)} 토큰`}
          </span>
        </div>
      )}
    </section>
  )
}
