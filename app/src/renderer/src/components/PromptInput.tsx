import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'

export interface PromptInputHandle {
  focus: () => void
}

interface Props {
  active: boolean
  busy: boolean
  historyKey: string
  initialHistory: string[]
  queued: boolean
  onQueue: (text: string) => void
  onSubmit: (text: string) => void
}

const HISTORY_LIMIT = 50

function readHistory(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(`ws.promptHistory.${key}`) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function keepLatestDuplicates(items: string[]): string[] {
  return items.filter((item, index) => items.lastIndexOf(item) === index)
}

/** 입력 중 App 전체가 다시 렌더링되지 않도록 값과 높이를 로컬에서 관리한다. */
const PromptInput = forwardRef<PromptInputHandle, Props>(function PromptInput(
  { active, busy, historyKey, initialHistory, queued, onQueue, onSubmit },
  ref,
) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(0)
  const draftRef = useRef('')
  const initialHistoryKey = initialHistory.join('\u0000')

  useEffect(() => {
    historyRef.current = keepLatestDuplicates([
      ...readHistory(historyKey),
      ...initialHistory,
    ]).slice(-HISTORY_LIMIT)
    historyIndexRef.current = historyRef.current.length
  }, [historyKey, initialHistoryKey])

  useEffect(() => {
    draftRef.current = ''
    setValue('')
  }, [historyKey])

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), [])

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    const style = getComputedStyle(element)
    const lineHeight = parseFloat(style.lineHeight) || 22
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    const maxHeight = lineHeight * 5 + padding
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value])

  const submit = (): void => {
    const text = value.trim()
    if (!active || !text) return
    const history = historyRef.current
    if (history.at(-1) !== text) {
      historyRef.current = [...history, text].slice(-HISTORY_LIMIT)
      localStorage.setItem(`ws.promptHistory.${historyKey}`, JSON.stringify(historyRef.current))
    }
    historyIndexRef.current = historyRef.current.length
    draftRef.current = ''
    if (busy) onQueue(text)
    else onSubmit(text)
    setValue('')
  }

  const recall = (direction: -1 | 1): void => {
    const history = historyRef.current
    if (history.length === 0) return
    if (historyIndexRef.current === history.length) draftRef.current = value
    const next = Math.max(0, Math.min(history.length, historyIndexRef.current + direction))
    if (next === historyIndexRef.current) return
    historyIndexRef.current = next
    setValue(next === history.length ? draftRef.current : history[next])
  }

  return (
    <>
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          window.dispatchEvent(new Event('workspace:user-interaction'))
        }}
        onKeyDown={(event) => {
          const target = event.currentTarget
          // Alt+방향키는 전역 프로젝트·세션 탐색 단축키에 맡긴다.
          if (event.altKey && event.key.startsWith('Arrow')) return
          if (event.key === 'ArrowUp' && target.selectionStart === 0) {
            event.preventDefault()
            event.stopPropagation()
            recall(-1)
            return
          }
          if (event.key === 'ArrowDown' && target.selectionStart === value.length) {
            event.preventDefault()
            event.stopPropagation()
            recall(1)
            return
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
        placeholder={
          !active
            ? '먼저 프로젝트를 추가하세요'
            : busy
              ? queued
                ? '다음 지시가 예약됨 · 새 내용으로 교체할 수 있습니다'
                : '실행 중 · 다음 지시를 미리 입력하고 Enter로 예약'
              : '지시를 입력하고 Enter · Shift+Enter 줄바꿈 · 이미지는 붙여넣기/드래그'
        }
        disabled={!active}
        className="flex-1 rounded-lg border border-surface1 bg-base px-3 py-2.5 text-sm leading-relaxed text-text outline-none placeholder:text-overlay1 focus:border-lavender/60 disabled:opacity-50"
      />
      <button
        onClick={submit}
        disabled={!active || !value.trim()}
        title={busy ? '다음 지시 예약' : '실행'}
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-lavender/20 text-lavender hover:bg-lavender/30 disabled:opacity-30"
      >
        <Send className="h-4 w-4" />
      </button>
    </>
  )
})

export default PromptInput
