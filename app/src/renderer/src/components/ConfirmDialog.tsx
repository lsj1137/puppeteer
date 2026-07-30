import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  title: string
  description?: string
  detail?: string
  confirmLabel?: string
  tone?: 'danger' | 'normal'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  description,
  detail,
  confirmLabel = '확인',
  tone = 'normal',
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  const danger = tone === 'danger'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-crust/70 p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-surface1 bg-mantle p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              danger ? 'bg-red/15 text-red' : 'bg-lavender/15 text-lavender'
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text">{title}</div>
            {description && (
              <div className="mt-1 text-[12px] leading-relaxed text-subtext0">{description}</div>
            )}
          </div>
        </div>

        {detail && (
          <div className="mb-4 truncate rounded-md bg-crust px-2.5 py-2 font-mono text-[11px] text-subtext1">
            {detail}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-surface1 px-3 py-1.5 text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`rounded-md px-3 py-1.5 text-[12px] font-medium ${
              danger ? 'bg-red/20 text-red hover:bg-red/30' : 'bg-lavender/20 text-lavender hover:bg-lavender/30'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
