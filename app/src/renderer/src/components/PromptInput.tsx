import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'

export interface PromptInputHandle {
  focus: () => void
}

interface Props {
  active: boolean
  busy: boolean
  onSubmit: (text: string) => void
}

/** 입력 중 App 전체가 다시 렌더링되지 않도록 값과 높이를 로컬에서 관리한다. */
const PromptInput = forwardRef<PromptInputHandle, Props>(function PromptInput(
  { active, busy, onSubmit },
  ref,
) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    if (!active || busy || !text) return
    onSubmit(text)
    setValue('')
  }

  return (
    <>
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
        placeholder={
          !active
            ? '먼저 프로젝트를 추가하세요'
            : busy
              ? '이 세션은 실행 중 · 새 세션은 ＋ 로 시작하세요'
              : '지시를 입력하고 Enter · Shift+Enter 줄바꿈 · 이미지는 붙여넣기/드래그'
        }
        disabled={!active || busy}
        className="flex-1 rounded-lg border border-surface1 bg-base px-3 py-2.5 text-sm leading-relaxed text-text outline-none placeholder:text-overlay1 focus:border-lavender/60 disabled:opacity-50"
      />
      <button
        onClick={submit}
        disabled={!active || !value.trim() || busy}
        title="실행"
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-lavender/20 text-lavender hover:bg-lavender/30 disabled:opacity-30"
      >
        <Send className="h-4 w-4" />
      </button>
    </>
  )
})

export default PromptInput
