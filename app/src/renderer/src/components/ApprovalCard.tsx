import { Check, ShieldAlert, X } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest } from '@shared/session'

const RISK = {
  high: { ring: 'border-red/50 bg-red/5', text: 'text-red', label: '높음' },
  med: { ring: 'border-peach/50 bg-peach/5', text: 'text-peach', label: '보통' },
  low: { ring: 'border-surface1 bg-surface0/40', text: 'text-subtext0', label: '낮음' },
} as const

interface Props {
  approval: ApprovalRequest
  onDecide: (id: string, decision: ApprovalDecision) => void
}

export default function ApprovalCard({ approval, onDecide }: Props) {
  const risk = RISK[approval.risk] ?? RISK.low
  return (
    <div className={`rounded-lg border p-3.5 ${risk.ring}`}>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <ShieldAlert className={`h-4 w-4 ${risk.text}`} />
        <span className="text-sm font-semibold text-text">승인 요청</span>
        <span className="rounded bg-surface0 px-1.5 py-0.5 font-mono text-[12px] text-subtext1">
          {approval.tool}
        </span>
        <span className={`text-[11px] ${risk.text}`}>위험도 {risk.label}</span>
        {approval.pending && (
          <span className="rounded bg-yellow/20 px-1.5 py-0.5 text-[11px] text-yellow">보류됨</span>
        )}
      </div>

      <pre className="mb-2 max-h-40 overflow-auto rounded-md bg-crust p-2.5 font-mono text-[12px] leading-relaxed text-subtext1">
        {JSON.stringify(approval.input, null, 2)}
      </pre>
      <div className="mb-3 truncate text-[11px] text-overlay1">{approval.cwd}</div>

      {approval.pending ? (
        <div className="text-[12px] text-yellow">
          응답 대기 시간이 지나 세션에는 보류로 통보했습니다.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onDecide(approval.id, 'allow-once')}
            className="flex items-center gap-1.5 rounded-md bg-green/15 px-3 py-1.5 text-[12px] font-medium text-green hover:bg-green/25"
          >
            <Check className="h-3.5 w-3.5" /> 이번만 허용
          </button>
          <button
            onClick={() => onDecide(approval.id, 'allow-session')}
            className="rounded-md border border-surface1 px-3 py-1.5 text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
          >
            이 세션 동안 허용
          </button>
          <button
            onClick={() => onDecide(approval.id, 'deny')}
            className="flex items-center gap-1.5 rounded-md bg-red/15 px-3 py-1.5 text-[12px] font-medium text-red hover:bg-red/25"
          >
            <X className="h-3.5 w-3.5" /> 거부
          </button>
        </div>
      )}
    </div>
  )
}
