import { Gauge } from 'lucide-react'
import type { CostTotals } from '@shared/session'
import { formatTokens } from '../lib/session-view'

interface Props {
  cost: CostTotals
  limit?: { ratio: number; label: string; remain: string }
  sessionCost: number
  sessionTokens: number
}

export default function UsageSummary({ cost, limit, sessionCost, sessionTokens }: Props) {
  return (
    <section className="mt-auto space-y-1.5 border-t border-surface0 px-1 pt-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-overlay1">
        <Gauge className="h-3.5 w-3.5" /> 사용량
      </div>
      {limit && (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface0">
            <div
              className={`h-full rounded-full transition-all ${
                limit.ratio > 0.85 ? 'bg-peach' : 'bg-green'
              }`}
              style={{ width: `${Math.round(limit.ratio * 100)}%` }}
            />
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
