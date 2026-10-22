import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { matchOffsets } from '../lib/text-search'

const ALL = 'conversation-search'
const CURRENT = 'conversation-search-current'

/** 검색창 자신처럼 검색에서 뺄 영역 */
export const SEARCH_IGNORE_ATTR = 'data-search-ignore'

function highlightsSupported(): boolean {
  return typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && 'highlights' in CSS
}

function clearHighlights(): void {
  if (!highlightsSupported()) return
  CSS.highlights.delete(ALL)
  CSS.highlights.delete(CURRENT)
}

/** 대화 영역의 보이는 글자에서 일치 범위를 모은다. 여러 텍스트 노드에 걸친 일치는 잡지 않는다. */
function collectRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = []
  const length = query.trim().length
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(`[${SEARCH_IGNORE_ATTR}]`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const at of matchOffsets(node.textContent ?? '', query)) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + length)
      ranges.push(range)
    }
  }
  return ranges
}

/**
 * 열린 세션의 대화에서 찾기(Ctrl+F).
 *
 * 강조는 CSS Custom Highlight API 로 한다. 마크다운·코드 블록 DOM 을 <mark> 로 쪼개지 않고
 * 범위만 칠하므로 React 가 그린 화면을 건드리지 않는다. 응답이 스트리밍으로 늘어나도 따라가도록
 * 대화 영역의 변화를 지켜보다가 다시 찾는다.
 */
export function useConversationSearch(root: RefObject<HTMLElement | null>, resetKey: string | undefined) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(0)
  const [index, setIndex] = useState(0)
  const ranges = useRef<Range[]>([])

  const paint = useCallback((current: number) => {
    if (!highlightsSupported()) return
    const list = ranges.current
    if (list.length === 0) return clearHighlights()
    CSS.highlights.set(ALL, new Highlight(...list))
    CSS.highlights.set(CURRENT, new Highlight(list[current]))
  }, [])

  const scrollTo = useCallback(
    (current: number) => {
      const range = ranges.current[current]
      const container = root.current
      if (!range || !container) return
      const rect = range.getBoundingClientRect()
      const box = container.getBoundingClientRect()
      // 이미 화면 안쪽(위아래 여유 포함)이면 움직이지 않는다. 다음 일치로 넘길 때 화면이 덜 흔들린다.
      if (rect.top >= box.top + 48 && rect.bottom <= box.bottom - 48) return
      container.scrollTo({ top: container.scrollTop + rect.top - box.top - container.clientHeight / 2, behavior: 'smooth' })
    },
    [root],
  )

  const search = useCallback(
    (keepIndex: boolean) => {
      const container = root.current
      if (!container || !open || !query.trim()) {
        ranges.current = []
        setCount(0)
        setIndex(0)
        clearHighlights()
        return
      }
      ranges.current = collectRanges(container, query)
      const total = ranges.current.length
      setCount(total)
      setIndex((previous) => {
        const next = keepIndex ? Math.min(previous, Math.max(0, total - 1)) : 0
        paint(next)
        if (!keepIndex) scrollTo(next)
        return next
      })
    },
    [open, paint, query, root, scrollTo],
  )

  // 검색어가 바뀌면 처음 일치부터
  useEffect(() => search(false), [search])

  // 대화가 늘어나거나 바뀌면 다시 찾되 보던 위치는 지킨다
  useEffect(() => {
    const container = root.current
    if (!open || !container) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => search(true), 200)
    })
    observer.observe(container, { subtree: true, childList: true, characterData: true })
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [open, root, search])

  // 세션을 바꾸면 닫는다. 다른 세션의 검색어가 남아 있으면 헷갈린다.
  useEffect(() => {
    setOpen(false)
    setQuery('')
  }, [resetKey])

  useEffect(() => () => clearHighlights(), [])

  const move = useCallback(
    (step: 1 | -1) => {
      const total = ranges.current.length
      if (total === 0) return
      setIndex((previous) => {
        const next = (previous + step + total) % total
        paint(next)
        scrollTo(next)
        return next
      })
    },
    [paint, scrollTo],
  )

  const close = useCallback(() => {
    setOpen(false)
    ranges.current = []
    setCount(0)
    clearHighlights()
  }, [])

  return {
    open,
    query,
    count,
    index,
    show: () => setOpen(true),
    close,
    setQuery,
    next: () => move(1),
    previous: () => move(-1),
  }
}
