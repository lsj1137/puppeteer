import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_SESSION_VIEW,
  reduceSessionView,
  type SessionView,
} from '../lib/session-view'
import { eventsAfterRestore, type LiveEvent } from '../lib/restore-merge'
import type { SessionStatus } from '@shared/session'

interface UseSessionViewsResult {
  views: Record<string, SessionView>
  addDiffArtifact: (sessionId: string, path: string) => Promise<string>
  failSessionView: (sessionId: string, reason: string) => void
  forgetSessionView: (sessionId: string) => void
  dismissWorktreeReviewNotices: (sessionId: string) => void
  restoreSessionView: (sessionId: string) => Promise<void>
}

/** 세션 이벤트의 실시간 수신과 DB 복원을 한 상태 저장소로 묶는다. */
export function useSessionViews(
  projectPath: string | undefined,
  onStatus: (projectPath: string | undefined, sessionId: string, status: SessionStatus) => Promise<void>,
): UseSessionViewsResult {
  const [views, setViews] = useState<Record<string, SessionView>>({})
  const eventSequence = useRef(0)
  /** DB 에서 전체 기록을 불러온 세션. 실시간 이벤트만으로 만들어진 화면은 앞부분이 빠져 있을 수 있다. */
  const restored = useRef(new Set<string>())
  /** 복원 중인 세션에 그 사이 도착한 이벤트 */
  const restoring = useRef(new Map<string, LiveEvent[]>())

  useEffect(() => {
    return window.api.onSessionEvent(({ sessionId, eventId, event }) => {
      restoring.current.get(sessionId)?.push({ eventId, event })
      setViews((current) => ({
        ...current,
        [sessionId]: reduceSessionView(
          current[sessionId] ?? EMPTY_SESSION_VIEW,
          event,
          `e${eventSequence.current++}`,
        ),
      }))
      if (event.t === 'status') void onStatus(projectPath, sessionId, event.status)
    })
  }, [onStatus, projectPath])

  /**
   * DB 기록으로 화면을 다시 만든다. 이미 복원한 세션은 건너뛴다.
   *
   * 실행 중인 세션을 새로고침하면 DB 를 읽기 전에 실시간 이벤트가 먼저 와서 화면이 «뒷부분만» 으로 생긴다.
   * 예전엔 화면이 있으면 복원을 버려서 위쪽 대화가 사라졌다. 이제는 DB 기록으로 바꾸고,
   * 읽는 사이 도착한 이벤트만 id 로 골라 뒤에 잇는다.
   */
  const restoreSessionView = useCallback(async (sessionId: string): Promise<void> => {
    if (restored.current.has(sessionId) || restoring.current.has(sessionId)) return
    restoring.current.set(sessionId, [])
    try {
      const stored = await window.api.listEvents(sessionId)
      let view = EMPTY_SESSION_VIEW
      for (const item of stored) {
        view = reduceSessionView(view, item.event, `h${item.id}`)
      }
      const late = eventsAfterRestore(stored.at(-1)?.id ?? 0, restoring.current.get(sessionId) ?? [])
      for (const event of late) {
        view = reduceSessionView(view, event, `e${eventSequence.current++}`)
      }
      restored.current.add(sessionId)
      setViews((current) => ({ ...current, [sessionId]: view }))
    } finally {
      restoring.current.delete(sessionId)
    }
  }, [])

  const addDiffArtifact = useCallback(async (sessionId: string, path: string): Promise<string> => {
    const content = await window.api.fileDiff(sessionId, path)
    const id = `diff:${path}`
    setViews((current) => {
      const view = current[sessionId] ?? EMPTY_SESSION_VIEW
      if (view.artifacts.some((artifact) => artifact.id === id)) return current
      return {
        ...current,
        [sessionId]: {
          ...view,
          artifacts: [
            ...view.artifacts,
            { id, kind: 'diff', language: 'diff', path, content: content || '(변경 없음)' },
          ],
        },
      }
    })
    return id
  }, [])

  const failSessionView = useCallback((sessionId: string, reason: string): void => {
    setViews((current) => ({
      ...current,
      [sessionId]: {
        ...(current[sessionId] ?? EMPTY_SESSION_VIEW),
        status: 'failed',
        statusReason: reason,
      },
    }))
  }, [])

  const forgetSessionView = useCallback((sessionId: string): void => {
    restored.current.delete(sessionId)
    setViews((current) => {
      if (!current[sessionId]) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [])

  const dismissWorktreeReviewNotices = useCallback((sessionId: string): void => {
    setViews((current) => {
      const view = current[sessionId]
      if (!view) return current
      const entries = view.entries.filter(
        (entry) => entry.kind !== 'notice' || entry.title !== '커밋·병합 검토 필요',
      )
      if (entries.length === view.entries.length) return current
      return { ...current, [sessionId]: { ...view, entries } }
    })
  }, [])

  return {
    views,
    addDiffArtifact,
    failSessionView,
    forgetSessionView,
    dismissWorktreeReviewNotices,
    restoreSessionView,
  }
}
