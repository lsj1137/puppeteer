import { useState } from 'react'
import { ChevronDown, ChevronUp, Gauge } from 'lucide-react'
import type { CostTotals } from '@shared/session'
import { formatTokens } from '../lib/session-view'

interface Props {
  cost: CostTotals
  limit?: { ratio: number; label: string; remain: string }
  sessionCost: number
  sessionTokens: number
}

export default function UsageSummary({ cost, limit, sessionCost, sessionTokens }: Props) {
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem('ws.usageExpanded') !== 'false',
  )
  const percent = limit ? Math.round(limit.ratio * 100) : undefined
  const toggle = (): void => {
    setExpanded((current) => {
      localStorage.setItem('ws.usageExpanded', String(!current))
      return !current
    })
  }

  if (!expanded) {
    return (
      <section className="mt-auto border-t border-surface0 px-1 pt-2.5">
        <button
          type="button"
          aria-expanded={false}
          onClick={toggle}
          title="사용량 상세 펼치기"
          className="group flex w-full items-center gap-2 rounded px-0.5 py-1 hover:bg-surface0/50"
        >
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface0">
            <div
              className={`h-full rounded-full transition-all ${
                (limit?.ratio ?? 0) > 0.85 ? 'bg-peach' : 'bg-green'
              }`}
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
    <section className="mt-auto space-y-1.5 border-t border-surface0 px-1 pt-2.5">
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
      {limit && (
        <>
          <div className="flex items-center gap-2">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface0">
              <div
                className={`h-full rounded-full transition-all ${
                  limit.ratio > 0.85 ? 'bg-peach' : 'bg-green'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-subtext1">
              {percent}%
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-overlay1">
            <span>{limit.label} 한도</span>
            <span>{limit.remain} 남음</span>
          </div>
        </>
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
