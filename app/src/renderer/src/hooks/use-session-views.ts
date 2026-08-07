import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_SESSION_VIEW,
  reduceSessionView,
  type SessionView,
} from '../lib/session-view'

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
  onStatus: (projectPath?: string) => Promise<void>,
): UseSessionViewsResult {
  const [views, setViews] = useState<Record<string, SessionView>>({})
  const eventSequence = useRef(0)

  useEffect(() => {
    return window.api.onSessionEvent(({ sessionId, event }) => {
      setViews((current) => ({
        ...current,
        [sessionId]: reduceSessionView(
          current[sessionId] ?? EMPTY_SESSION_VIEW,
          event,
          `e${eventSequence.current++}`,
        ),
      }))
      if (event.t === 'status') void onStatus(projectPath)
    })
  }, [onStatus, projectPath])

  const restoreSessionView = useCallback(async (sessionId: string): Promise<void> => {
    const stored = await window.api.listEvents(sessionId)
    let restored = EMPTY_SESSION_VIEW
    for (const item of stored) {
      restored = reduceSessionView(restored, item.event, `h${item.id}`)
    }
    setViews((current) => (current[sessionId] ? current : { ...current, [sessionId]: restored }))
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
