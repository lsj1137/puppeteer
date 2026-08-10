import { CheckCircle2, X } from 'lucide-react'
import type { StoredProject, StoredSession } from '@shared/session'
import { baseName } from '../lib/session-view'

export interface SessionCompletionToast {
  session: StoredSession
  closing: boolean
}

interface Props {
  items: SessionCompletionToast[]
  projects: StoredProject[]
  onDismiss: (sessionId: string) => void
  onOpen: (session: StoredSession) => void | Promise<void>
}

/** 실행 중이던 세션의 완료를 현재 화면을 가리지 않고 알려준다. */
export default function SessionCompletionToasts({ items, projects, onDismiss, onOpen }: Props) {
  if (items.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[90] flex w-[min(360px,calc(100vw-2.5rem))] flex-col gap-2">
      {items.map(({ session, closing }) => {
        const project = projects.find(({ path }) => path === session.projectPath)
        return (
          <div
            key={session.id}
            style={{
              opacity: closing ? 0 : 1,
              transform: closing ? 'translateX(calc(100% + 32px))' : 'translateX(0)',
            }}
            className={`pointer-events-auto relative overflow-hidden rounded-xl border border-green/25 bg-mantle/95 shadow-2xl backdrop-blur transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.4,0,1,1)] will-change-transform ${
              closing
                ? ''
                : 'animate-[completion-toast-in_220ms_cubic-bezier(0.2,0.8,0.2,1)]'
            }`}
          >
            <button
              type="button"
              onClick={() => void onOpen(session)}
              className="flex w-full appearance-none items-center gap-3 border-0 bg-transparent px-3.5 py-3 text-left no-underline outline-none hover:bg-surface0/45 hover:no-underline focus:outline-none"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green/15 text-green">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-green">세션 완료</span>
                <span className="block truncate text-[13px] text-text">{session.title || '새 세션'}</span>
                <span className="block truncate text-[11px] text-overlay1">
                  {project?.alias || baseName(session.projectPath)}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDismiss(session.id)}
              title="알림 닫기"
              className="absolute right-2 top-2 rounded p-1 text-overlay1 hover:bg-surface1 hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
