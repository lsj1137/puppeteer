import { ChevronDown, Wrench } from 'lucide-react'
import type { Entry } from '../lib/session-view'

interface Props {
  entry: Extract<Entry, { kind: 'tool' }>
}

/** 긴 도구 입출력은 기본으로 감추고 필요할 때만 펼친다. */
export default function ToolEntry({ entry }: Props) {
  const failed = Boolean(entry.result && !entry.result.ok)
  const status = entry.result ? (entry.result.ok ? '완료' : '실패') : '실행 중'
  const input =
    typeof entry.input === 'string' ? entry.input : JSON.stringify(entry.input, null, 2)

  return (
    <details
      className={`group rounded-md text-[12px] ${failed ? 'bg-red/10' : 'bg-sapphire/10'}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 [&::-webkit-details-marker]:hidden">
        <Wrench className={`h-3.5 w-3.5 shrink-0 ${failed ? 'text-red' : 'text-sapphire'}`} />
        <span className={`font-medium ${failed ? 'text-red' : 'text-sapphire'}`}>
          {entry.name}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-overlay1">{status}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-overlay1 transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-surface0/60 px-3 py-2">
        <div className="mb-1 text-[11px] font-medium text-overlay1">입력</div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-crust/60 px-2 py-1.5 font-mono text-[12px] leading-relaxed text-subtext0">
          {input}
        </pre>
        {entry.result?.preview && (
          <>
            <div className="mb-1 mt-2 text-[11px] font-medium text-overlay1">결과</div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-crust/60 px-2 py-1.5 font-mono text-[12px] leading-relaxed text-subtext0">
              {entry.result.preview}
            </pre>
          </>
        )}
      </div>
    </details>
  )
}
