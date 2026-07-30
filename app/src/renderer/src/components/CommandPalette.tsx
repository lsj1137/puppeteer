import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Search } from 'lucide-react'

export interface Command {
  id: string
  group: string
  label: string
  hint?: string
  icon?: LucideIcon
  run: () => void
}

/** 부분 문자열이 순서대로 등장하면 통과 (fuzzy 근사) */
function matches(haystack: string, needle: string): boolean {
  if (!needle) return true
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  let i = 0
  for (const ch of n) {
    i = h.indexOf(ch, i)
    if (i === -1) return false
    i += 1
  }
  return true
}

export default function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[]
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const hits = useMemo(
    () => commands.filter((c) => matches(`${c.group} ${c.label} ${c.hint ?? ''}`, q)).slice(0, 80),
    [commands, q],
  )

  useEffect(() => setCursor(0), [q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') return onClose()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(c + 1, hits.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(c - 1, 0))
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const hit = hits[cursor]
        if (hit) {
          onClose()
          hit.run()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hits, cursor, onClose])

  useEffect(() => {
    listRef.current?.querySelector('[data-on="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  let lastGroup = ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-crust/70 p-6 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-surface1 bg-mantle shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 bg-surface0/40 px-3.5 py-3">
          <Search className="h-4 w-4 shrink-0 text-overlay1" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="프로젝트 · 세션 · 승인 · 명령 검색"
            className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-overlay1"
          />
          <kbd className="shrink-0 rounded border border-surface1 px-1.5 py-0.5 text-[11px] text-overlay1">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-1.5">
          {hits.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-overlay1">결과 없음</div>
          )}

          {hits.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : undefined
            lastGroup = c.group
            const on = i === cursor
            const Icon = c.icon
            return (
              <div key={c.id}>
                {header && (
                  <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-overlay1">
                    {header}
                  </div>
                )}
                <button
                  data-on={on ? '1' : '0'}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => {
                    onClose()
                    c.run()
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm ${
                    on ? 'bg-surface0 text-text' : 'text-subtext1'
                  }`}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0 text-sapphire" />}
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.hint && (
                    <span className="shrink-0 truncate text-[12px] text-overlay1">{c.hint}</span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
