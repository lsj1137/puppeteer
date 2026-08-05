import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { StoredProject, StoredSession } from '@shared/session'
import type { SessionView } from '../lib/session-view'

type Screen = 'project' | 'overview' | 'agents' | 'memory' | 'skills'
type Attachment = { path: string; url: string; name: string }

interface Options {
  activeProjectPath?: string
  activeSessionId?: string
  sessions: StoredSession[]
  views: Record<string, SessionView>
  forgetSessionView: (sessionId: string) => void
  refresh: (projectPath?: string) => Promise<void>
  restoreSessionView: (sessionId: string) => Promise<void>
  focusPrompt: () => void
  setActiveProjectPath: Dispatch<SetStateAction<string | undefined>>
  setActiveSessionId: Dispatch<SetStateAction<string | undefined>>
  setAgentName: Dispatch<SetStateAction<string | undefined>>
  setAttachments: Dispatch<SetStateAction<Attachment[]>>
  setConfirmDrop: Dispatch<SetStateAction<string | undefined>>
  setConfirmDelete: Dispatch<SetStateAction<StoredSession | undefined>>
  setDeleteError: Dispatch<SetStateAction<string | undefined>>
  setNextRunnerId: Dispatch<SetStateAction<string | undefined>>
  setPendingPrompt: Dispatch<SetStateAction<string | undefined>>
  setProjects: Dispatch<SetStateAction<StoredProject[]>>
  setScreen: Dispatch<SetStateAction<Screen>>
  setScrolled: Dispatch<SetStateAction<boolean>>
  setSelectedArtifact: Dispatch<SetStateAction<string | undefined>>
  setSessions: Dispatch<SetStateAction<StoredSession[]>>
}

/** 프로젝트와 세션 사이의 이동 및 삭제 수명주기를 관리한다. */
export function useWorkspaceNavigation(options: Options) {
  const {
    activeProjectPath,
    activeSessionId,
    sessions,
    views,
    forgetSessionView,
    refresh,
    restoreSessionView,
    focusPrompt,
    setActiveProjectPath,
    setActiveSessionId,
    setAgentName,
    setAttachments,
    setConfirmDrop,
    setConfirmDelete,
    setDeleteError,
    setNextRunnerId,
    setPendingPrompt,
    setProjects,
    setScreen,
    setScrolled,
    setSelectedArtifact,
    setSessions,
  } = options
  const viewsRef = useRef(views)
  viewsRef.current = views

  const selectProject = useCallback(
    (path: string): void => {
      setScreen('project')
      setPendingPrompt(undefined)
      setNextRunnerId(undefined)
      setScrolled(false)
      setActiveProjectPath(path || undefined)
      setActiveSessionId(undefined)
      setSelectedArtifact(undefined)
      setAttachments([])
    },
    [
      setActiveProjectPath,
      setActiveSessionId,
      setAttachments,
      setNextRunnerId,
      setPendingPrompt,
      setScreen,
      setScrolled,
      setSelectedArtifact,
    ],
  )

  const openSession = useCallback(
    async (id: string, candidates = sessions): Promise<void> => {
      const target = candidates.find((session) => session.id === id)
      setScreen('project')
      setPendingPrompt(undefined)
      setNextRunnerId(target?.runnerId ?? undefined)
      setScrolled(false)
      setActiveSessionId(id)
      setAgentName(target?.agentName ?? undefined)
      setSelectedArtifact(undefined)
      if (!viewsRef.current[id]) await restoreSessionView(id)
    },
    [
      restoreSessionView,
      sessions,
      setActiveSessionId,
      setAgentName,
      setNextRunnerId,
      setPendingPrompt,
      setScreen,
      setScrolled,
      setSelectedArtifact,
    ],
  )

  const jumpTo = useCallback(
    async (sessionId: string, projectPath: string): Promise<void> => {
      let targetSessions = sessions
      if (projectPath !== activeProjectPath) {
        setActiveProjectPath(projectPath)
        targetSessions = await window.api.listSessions(projectPath)
        setSessions(targetSessions)
      }
      await openSession(sessionId, targetSessions)
    },
    [activeProjectPath, openSession, sessions, setActiveProjectPath, setSessions],
  )

  useEffect(() => {
    return window.api.onNotifyJump(({ sessionId, cwd }) => void jumpTo(sessionId, cwd))
  }, [jumpTo])

  const removeSession = useCallback(
    async (id: string): Promise<void> => {
      setDeleteError(undefined)
      const result = await window.api.deleteSession(id)
      if (!result.ok) {
        setDeleteError(result.message ?? '세션을 삭제하지 못했습니다.')
        return
      }
      setConfirmDelete(undefined)
      forgetSessionView(id)
      if (activeSessionId === id) {
        setActiveSessionId(undefined)
        setSelectedArtifact(undefined)
      }
      void refresh(activeProjectPath)
    },
    [
      activeProjectPath,
      activeSessionId,
      forgetSessionView,
      refresh,
      setActiveSessionId,
      setConfirmDelete,
      setDeleteError,
      setSelectedArtifact,
    ],
  )

  const newSession = useCallback((): void => {
    setScrolled(false)
    setPendingPrompt(undefined)
    setActiveSessionId(undefined)
    setSelectedArtifact(undefined)
    focusPrompt()
  }, [focusPrompt, setActiveSessionId, setPendingPrompt, setScrolled, setSelectedArtifact])

  const pickFolder = useCallback(async (): Promise<void> => {
    const path = await window.api.pickProject()
    if (!path) return
    setProjects(await window.api.listProjects())
    selectProject(path)
  }, [selectProject, setProjects])

  const dropProject = useCallback(
    async (path: string): Promise<void> => {
      setConfirmDrop(undefined)
      await window.api.removeProject(path)
      const next = await window.api.listProjects()
      setProjects(next)
      if (path === activeProjectPath) selectProject(next[0]?.path ?? '')
    },
    [activeProjectPath, selectProject, setConfirmDrop, setProjects],
  )

  return { dropProject, jumpTo, newSession, openSession, pickFolder, removeSession, selectProject }
}
