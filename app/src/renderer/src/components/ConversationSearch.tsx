import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { SEARCH_IGNORE_ATTR } from '../hooks/use-conversation-search'

interface Props {
  query: string
  count: number
  index: number
  /** Ctrl+F 를 다시 누를 때마다 바뀐다 — 입력칸으로 다시 데려온다 */
  focusSignal: number
  onQuery: (query: string) => void
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
}

/**
 * 대화 영역 오른쪽 위에 떠 있는 찾기 막대. 대화 스크롤 영역 안에서 sticky 로 붙어
 * 내용을 밀어내지 않는다(아래쪽 음수 여백으로 자기 높이만큼 되돌린다).
 */
export default function ConversationSearch({
  query,
  count,
  index,
  focusSignal,
  onQuery,
  onNext,
  onPrevious,
  onClose,
}: Props) {
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusSignal])

  const status = !query.trim() ? '' : count === 0 ? '없음' : `${index + 1}/${count}`

  return (
    <div {...{ [SEARCH_IGNORE_ATTR]: '' }} className="pointer-events-none sticky top-0 z-20 -mb-10 flex h-10 shrink-0 justify-end">
      <div className="pointer-events-auto flex h-9 items-center gap-1 rounded-lg border border-surface1 bg-mantle px-2 shadow-lg">
        <Search className="h-3.5 w-3.5 shrink-0 text-overlay1" />
        <input
          ref={input}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) onPrevious()
              else onNext()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
          placeholder="대화에서 찾기"
          spellCheck={false}
          aria-label="대화에서 찾기"
          className="w-48 min-w-0 bg-transparent text-[13px] text-text outline-none placeholder:text-overlay0"
        />
        <span
          className={`w-12 shrink-0 text-right font-mono text-[11px] tabular-nums ${
            count === 0 && query.trim() ? 'text-red' : 'text-overlay1'
          }`}
        >
          {status}
        </span>
        <button type="button" onClick={onPrevious} disabled={count === 0} title="이전 (Shift+Enter)" className="rounded p-1 text-overlay1 hover:bg-surface0 hover:text-text disabled:opacity-40">
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onNext} disabled={count === 0} title="다음 (Enter)" className="rounded p-1 text-overlay1 hover:bg-surface0 hover:text-text disabled:opacity-40">
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onClose} title="닫기 (Esc)" className="rounded p-1 text-overlay1 hover:bg-surface0 hover:text-text">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
