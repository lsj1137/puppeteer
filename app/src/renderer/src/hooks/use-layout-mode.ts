import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  applyLayoutPreference,
  parseLayoutPreference,
  resolveLayoutMode,
  type LayoutMode,
  type LayoutPreference,
} from '../lib/layout-mode'

const KEY = 'ws.layout'
const listeners = new Set<() => void>()

let preference: LayoutPreference = parseLayoutPreference(localStorage.getItem(KEY))

export function setLayoutPreference(next: LayoutPreference): void {
  preference = next
  localStorage.setItem(KEY, next)
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  return () => listeners.delete(notify)
}

export function useLayoutPreference(): LayoutPreference {
  return useSyncExternalStore(subscribe, () => preference)
}

/**
 * 지금 써야 할 화면 배치.
 *
 * 창 크기는 resize 로만 바뀐다 — 매 렌더 읽으면 값이 흔들린다.
 * 판정 자체는 `resolveLayoutMode` 가 하고 여기서는 직전 값만 넘겨준다.
 */
export function useLayoutMode(): LayoutMode {
  const current = useLayoutPreference()
  const [automatic, setAutomatic] = useState<LayoutMode>(
    () => resolveLayoutMode(window.innerWidth, window.innerHeight),
  )

  useEffect(() => {
    const onResize = (): void =>
      setAutomatic((previous) => resolveLayoutMode(window.innerWidth, window.innerHeight, previous))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return applyLayoutPreference(current, automatic)
}
