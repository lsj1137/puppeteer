import React, { lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { initTheme } from './lib/theme'

initTheme()

const Root = lazy(() => window.location.hash.startsWith('#worktree-conflict')
  ? import('./components/WorktreeConflictResolver')
  : import('./App'))

const RECOVERY_KEY = 'puppeteer:renderer-recovery-at'

class RendererErrorBoundary extends React.Component<
  { children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer initialization failed', error, info.componentStack)
    const previous = Number(sessionStorage.getItem(RECOVERY_KEY)) || 0
    if (Date.now() - previous < 10_000) return
    sessionStorage.setItem(RECOVERY_KEY, String(Date.now()))
    window.setTimeout(() => window.location.reload(), 700)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <main className="flex h-full items-center justify-center bg-crust p-6 text-text">
        <section className="w-full max-w-lg rounded-xl border border-red/30 bg-mantle p-5 shadow-2xl">
          <h1 className="text-base font-semibold">화면을 복구하지 못했습니다</h1>
          <p className="mt-2 text-sm text-subtext0">
            파일 변경 중 렌더러 재시작이 중단됐습니다. 작업 세션은 메인 프로세스에서 계속 유지됩니다.
          </p>
          <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-crust p-3 text-[11px] text-red">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-sapphire px-3 py-1.5 text-sm font-medium text-crust hover:bg-sky"
          >
            화면 다시 불러오기
          </button>
        </section>
      </main>
    )
  }
}

function RendererReady(): null {
  useEffect(() => sessionStorage.removeItem(RECOVERY_KEY), [])
  return null
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RendererErrorBoundary>
      <Suspense fallback={<div className="h-full bg-crust" />}>
        <Root />
        <RendererReady />
      </Suspense>
    </RendererErrorBoundary>
  </React.StrictMode>,
)

// 폰트가 조용히 시스템 글꼴로 떨어지면 눈치채기 어렵다. 실패는 남긴다.
void document.fonts.ready.then(() => {
  if (!document.fonts.check('14px Pretendard')) {
    console.warn('Pretendard 를 불러오지 못했습니다 — 시스템 폰트로 표시됩니다')
  }
})
