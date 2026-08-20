import { useEffect } from 'react'
import { Check, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest } from '@shared/session'

const RISK = {
  high: { ring: 'border-red/50 bg-red/5', text: 'text-red', label: '높음' },
  med: { ring: 'border-peach/50 bg-peach/5', text: 'text-peach', label: '보통' },
  low: { ring: 'border-surface1 bg-surface0/40', text: 'text-subtext0', label: '낮음' },
} as const

interface Props {
  approval: ApprovalRequest
  shortcutsActive?: boolean
  onDecide: (id: string, decision: ApprovalDecision) => void
}

export default function ApprovalCard({ approval, shortcutsActive = true, onDecide }: Props) {
  const risk = RISK[approval.risk] ?? RISK.low
  useEffect(() => {
    if (approval.pending || !shortcutsActive) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      const decision = event.code === 'Space'
        ? 'allow-once'
        : event.key === 'Enter'
          ? 'allow-session'
          : event.key === 'Escape'
            ? 'deny'
            : undefined
      if (!decision) return
      event.preventDefault()
      onDecide(approval.id, decision)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [approval.id, approval.pending, onDecide, shortcutsActive])
  return (
    <div className={`rounded-lg border p-3.5 ${risk.ring}`}>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <ShieldAlert className={`h-4 w-4 ${risk.text}`} />
        <span className="text-sm font-semibold text-text">승인 요청</span>
        <span className="rounded bg-surface0 px-1.5 py-0.5 font-mono text-[12px] text-subtext1">
          {approval.tool}
        </span>
        <span className={`text-[11px] ${risk.text}`}>위험도 {risk.label}</span>
        {approval.runLabel && (
          <span className="rounded bg-mauve/15 px-1.5 py-0.5 text-[11px] text-mauve">
            {approval.runLabel}
          </span>
        )}
        {approval.pending && (
          <span className="rounded bg-yellow/20 px-1.5 py-0.5 text-[11px] text-yellow">보류됨</span>
        )}
      </div>

      <pre className="mb-2 max-h-40 overflow-auto rounded-md bg-crust p-2.5 font-mono text-[12px] leading-relaxed text-subtext1">
        {JSON.stringify(approval.input, null, 2)}
      </pre>
      <div className="mb-3 truncate text-[11px] text-overlay1">{approval.cwd}</div>

      {approval.pending ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] text-yellow">
            응답할 세션이 종료되었거나 대기 시간이 지나 보류되었습니다.
          </div>
          <button
            type="button"
            onClick={() => onDecide(approval.id, 'deny')}
            className="shrink-0 rounded-md px-2.5 py-1.5 text-[11px] text-overlay1 hover:bg-surface0 hover:text-text"
          >
            내역 지우기
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onDecide(approval.id, 'allow-once')}
            className="flex items-center gap-1.5 rounded-md bg-green/15 px-3 py-1.5 text-[12px] font-medium text-green hover:bg-green/25"
          >
            <Check className="h-3.5 w-3.5" /> 이번만 허용
            <kbd className="ml-1 rounded bg-green/15 px-1.5 py-0.5 font-mono text-[10px]">Space</kbd>
          </button>
          <button
            onClick={() => onDecide(approval.id, 'allow-session')}
            className="flex items-center gap-1.5 rounded-md border border-surface1 px-3 py-1.5 text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
          >
            <ShieldCheck className="h-3.5 w-3.5" /> 이 세션 동안 허용
            <kbd className="ml-1 rounded bg-surface0 px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
          </button>
          <button
            onClick={() => onDecide(approval.id, 'deny')}
            className="flex items-center gap-1.5 rounded-md bg-red/15 px-3 py-1.5 text-[12px] font-medium text-red hover:bg-red/25"
          >
            <X className="h-3.5 w-3.5" /> 거부
            <kbd className="ml-1 rounded bg-red/15 px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
          </button>
        </div>
      )}
    </div>
  )
}
