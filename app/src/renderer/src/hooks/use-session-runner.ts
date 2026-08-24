import { useCallback, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { DetectedRunner, StoredProject, StoredSession } from '@shared/session'
import { canApplyStartedSession, resolveSessionLaunch } from '../lib/session-launch'

interface UseSessionRunnerOptions {
  activeProjectPath?: string
  activeProjectRunnerId?: string | null
  activeSessionId?: string
  agentName?: string
  /** 새 세션에 지정할 모델. 이어가는 턴은 세션에 저장된 값을 쓴다. */
  model?: string | null
  attachments: { path: string }[]
  busy: boolean
  defaultRunnerId?: string
  nextRunnerId?: string
  pendingPrompt?: string
  runners: DetectedRunner[]
  selectedSession?: StoredSession
  failSessionView: (sessionId: string, reason: string) => void
  refresh: (projectPath?: string) => Promise<void>
  setActiveSessionId: Dispatch<SetStateAction<string | undefined>>
  setAttachments: Dispatch<SetStateAction<{ path: string; url: string; name: string }[]>>
  setNextRunnerId: Dispatch<SetStateAction<string | undefined>>
  setPendingPrompt: Dispatch<SetStateAction<string | undefined>>
  setProjects: Dispatch<SetStateAction<StoredProject[]>>
  setSelectedArtifact: Dispatch<SetStateAction<string | undefined>>
  /** 예약해 둔 지시가 실제로 나갔을 때. 화면은 바꾸지 않고 알림만 띄운다. */
  onQueuedSent?: (session: StoredSession) => void
}

interface FreshSessionOptions {
  agentName?: string
  cwd: string
  prompt: string
  runnerId: string
}

/** 러너 선택, 새 세션 시작, 기존 CLI 세션 재개를 한곳에서 조율한다. */
export function useSessionRunner(options: UseSessionRunnerOptions) {
  const {
    activeProjectPath,
    activeProjectRunnerId,
    activeSessionId,
    agentName,
    model,
    attachments,
    busy,
    defaultRunnerId,
    nextRunnerId,
    pendingPrompt,
    runners,
    selectedSession,
    failSessionView,
    refresh,
    setActiveSessionId,
    setAttachments,
    setNextRunnerId,
    setPendingPrompt,
    setProjects,
    setSelectedArtifact,
    onQueuedSent,
  } = options

  // 비동기 응답이 돌아온 «지금» 어느 프로젝트를 보고 있는지. 클로저가 캡처한 값은 낡을 수 있다.
  const currentProjectRef = useRef(activeProjectPath)
  currentProjectRef.current = activeProjectPath

  const run = useCallback(
    async (runnerId: string, text: string, cwd?: string): Promise<void> => {
      const runner = runners.find((candidate) => candidate.id === runnerId)
      const { path, sameRunner, resumeCliSessionId, continueSessionId } = resolveSessionLaunch(
        runnerId,
        activeSessionId,
        selectedSession,
        activeProjectPath,
        cwd,
      )
      if (!runner || !path) return
      if (!sameRunner) setActiveSessionId(undefined)

      try {
        const id = await window.api.startSession({
          runner,
          cwd: path,
          prompt: text,
          resumeCliSessionId,
          continueSessionId,
          attachments: attachments.map((attachment) => attachment.path),
          agentName,
          model,
        })
        setAttachments([])
        // 기다리는 동안 다른 프로젝트로 옮겼다면 화면을 되돌리지 않는다. 세션 목록도 건드리지
        // 않는다 — 지금 보고 있는 프로젝트의 탭이 남의 세션으로 바뀌면 더 헷갈린다.
        // 세션은 이미 시작됐고, 돌아오면 목록에서 열 수 있다.
        const stillHere = canApplyStartedSession(path, currentProjectRef.current)
        void refresh(stillHere ? path : undefined)
        if (!stillHere) return
        setActiveSessionId(id)
        setSelectedArtifact(undefined)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        if (!canApplyStartedSession(path, currentProjectRef.current)) return
        const key = sameRunner ? (activeSessionId ?? 'start-error') : 'start-error'
        failSessionView(key, reason)
        setActiveSessionId(key)
      }
    },
    [
      activeProjectPath,
      activeSessionId,
      agentName,
      model,
      attachments,
      failSessionView,
      refresh,
      runners,
      selectedSession,
      setActiveSessionId,
      setAttachments,
      setSelectedArtifact,
    ],
  )

  const chooseRunner = useCallback(
    async (runnerId: string, text?: string, cwd?: string): Promise<void> => {
      const path = cwd ?? activeProjectPath
      if (!path) return
      setNextRunnerId(runnerId)
      await window.api.setProjectRunner(path, runnerId)
      setProjects(await window.api.listProjects())
      const body = text ?? pendingPrompt
      setPendingPrompt(undefined)
      if (body) void run(runnerId, body, path)
    },
    [activeProjectPath, pendingPrompt, run, setNextRunnerId, setPendingPrompt, setProjects],
  )

  const submit = useCallback(
    (text: string): void => {
      if (!activeProjectPath || !text || busy) return
      const selectedRunnerId =
        nextRunnerId ?? selectedSession?.runnerId ?? activeProjectRunnerId ?? defaultRunnerId
      if (selectedRunnerId && runners.some(({ id, available }) => id === selectedRunnerId && available)) {
        void run(selectedRunnerId, text)
        return
      }
      const usable = runners.filter(({ available }) => available)
      if (usable.length === 1) {
        void chooseRunner(usable[0].id, text)
        return
      }
      setPendingPrompt(text)
    },
    [
      activeProjectPath,
      activeProjectRunnerId,
      busy,
      chooseRunner,
      defaultRunnerId,
      nextRunnerId,
      run,
      runners,
      selectedSession?.runnerId,
      setPendingPrompt,
    ],
  )

  const submitToSession = useCallback(
    async (text: string, sessionId: string): Promise<void> => {
      const target = await window.api.getSession(sessionId)
      if (!target || !text) return
      const runner = runners.find(({ id }) => id === target.runnerId)
      if (!runner) return
      try {
        const id = await window.api.startSession({
          runner,
          cwd: target.projectPath,
          prompt: text,
          resumeCliSessionId: target.cliSessionId ?? undefined,
          continueSessionId: target.id,
          attachments: attachments.map((attachment) => attachment.path),
          agentName: target.agentName ?? undefined,
        })
        setAttachments([])
        // 예약한 지시는 사용자가 다른 곳을 보는 동안 나간다. 화면을 그 세션으로 끌고 가면
        // 보던 것이 갑자기 사라진다 — 활성 세션은 그대로 두고 알림만 띄운다.
        const stillHere = canApplyStartedSession(target.projectPath, currentProjectRef.current)
        void refresh(stillHere ? target.projectPath : undefined)
        onQueuedSent?.(target)
      } catch (error) {
        failSessionView(
          sessionId,
          error instanceof Error ? error.message : String(error),
        )
      }
    },
    [attachments, failSessionView, onQueuedSent, refresh, runners, setAttachments],
  )

  const startFreshSession = useCallback(
    async ({ runnerId, cwd, prompt, agentName: freshAgent }: FreshSessionOptions): Promise<boolean> => {
      const runner = runners.find(({ id }) => id === runnerId)
      if (!runner) return false
      try {
        const id = await window.api.startSession({ runner, cwd, prompt, agentName: freshAgent })
        const stillHere = canApplyStartedSession(cwd, currentProjectRef.current)
        void refresh(stillHere ? cwd : undefined)
        if (!stillHere) return true
        setActiveSessionId(id)
        setSelectedArtifact(undefined)
        return true
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        if (!canApplyStartedSession(cwd, currentProjectRef.current)) return false
        failSessionView('start-error', reason)
        setActiveSessionId('start-error')
        return false
      }
    },
    [failSessionView, refresh, runners, setActiveSessionId, setSelectedArtifact],
  )

  return { chooseRunner, startFreshSession, submit, submitToSession }
}
