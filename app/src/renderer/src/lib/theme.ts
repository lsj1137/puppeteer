import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'

const KEY = 'ws.theme'
const listeners = new Set<() => void>()

let current: Theme = (localStorage.getItem(KEY) as Theme | null) ?? 'dark'

/** 첫 페인트 전에 적용해야 깜빡임이 없다 */
export function initTheme(): void {
  document.documentElement.dataset.theme = current
}

export function setTheme(t: Theme): void {
  current = t
  localStorage.setItem(KEY, t)
  document.documentElement.dataset.theme = t
  listeners.forEach((f) => f())
}

export function toggleTheme(): void {
  setTheme(current === 'dark' ? 'light' : 'dark')
}

function subscribe(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => current)
}

/** shiki 테마 이름 */
export const shikiTheme = (t: Theme): string =>
  t === 'dark' ? 'catppuccin-mocha' : 'catppuccin-latte'
