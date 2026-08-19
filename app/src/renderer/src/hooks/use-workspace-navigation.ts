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
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  /** 빠르게 프로젝트를 바꿀 때 이전 목록 응답이 새 선택을 덮지 않게 한다. */
  const projectSelection = useRef(0)

  const openSession = useCallback(
    async (id: string, candidates = sessionsRef.current): Promise<void> => {
      projectSelection.current++
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
      setActiveSessionId,
      setAgentName,
      setNextRunnerId,
      setPendingPrompt,
      setScreen,
      setScrolled,
      setSelectedArtifact,
    ],
  )

  const selectProject = useCallback(
    async (path: string, openLatest = true): Promise<void> => {
      const selection = ++projectSelection.current
      setScreen('project')
      setPendingPrompt(undefined)
      setNextRunnerId(undefined)
      setScrolled(false)
      setActiveProjectPath(path || undefined)
      setActiveSessionId(undefined)
      setSelectedArtifact(undefined)
      setAgentName(undefined)
      setAttachments([])

      if (!path || !openLatest) return
      const loaded = await window.api.listSessions(path)
      if (selection !== projectSelection.current) return
      setSessions(loaded)

      // 실제 세션 탭 클릭과 같은 경로로 열어 활성화와 대화 복원을 함께 처리한다.
      const latest = loaded[0]
      if (latest) await openSession(latest.id, loaded)
    },
    [
      openSession,
      setActiveProjectPath,
      setActiveSessionId,
      setAgentName,
      setAttachments,
      setNextRunnerId,
      setPendingPrompt,
      setScreen,
      setScrolled,
      setSelectedArtifact,
      setSessions,
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
        // 삭제한 세션의 Agent 가 남으면 다음에 시작하는 새 세션에 그대로 딸려간다.
        setAgentName(undefined)
      }
      void refresh(activeProjectPath)
    },
    [
      activeProjectPath,
      activeSessionId,
      forgetSessionView,
      refresh,
      setActiveSessionId,
      setAgentName,
      setConfirmDelete,
      setDeleteError,
      setSelectedArtifact,
    ],
  )

  const newSession = useCallback((): void => {
    projectSelection.current++
    setScrolled(false)
    setPendingPrompt(undefined)
    setActiveSessionId(undefined)
    setSelectedArtifact(undefined)
    // 직전 세션의 Agent 를 물려주지 않는다. 프로젝트를 열면 최근 세션이 자동 선택되므로
    // 여기서 비우지 않으면 고른 적 없는 Agent 가 새 세션에 그대로 박힌다.
    setAgentName(undefined)
    focusPrompt()
  }, [
    focusPrompt,
    setActiveSessionId,
    setAgentName,
    setPendingPrompt,
    setScrolled,
    setSelectedArtifact,
  ])

  const pickFolder = useCallback(async (): Promise<void> => {
    const path = await window.api.pickProject()
    if (!path) return
    setProjects(await window.api.listProjects())
    await selectProject(path)
  }, [selectProject, setProjects])

  const dropProject = useCallback(
    async (path: string): Promise<void> => {
      setConfirmDrop(undefined)
      await window.api.removeProject(path)
      const next = await window.api.listProjects()
      setProjects(next)
      if (path === activeProjectPath) await selectProject(next[0]?.path ?? '')
    },
    [activeProjectPath, selectProject, setConfirmDrop, setProjects],
  )

  return { dropProject, jumpTo, newSession, openSession, pickFolder, removeSession, selectProject }
}
