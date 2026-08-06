import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { DetectedRunner, StoredProject, StoredSession } from '@shared/session'
import { resolveSessionLaunch } from '../lib/session-launch'

interface UseSessionRunnerOptions {
  activeProjectPath?: string
  activeProjectRunnerId?: string | null
  activeSessionId?: string
  agentName?: string
  attachments: { path: string }[]
  busy: boolean
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
    attachments,
    busy,
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
  } = options

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
        })
        setAttachments([])
        setActiveSessionId(id)
        setSelectedArtifact(undefined)
        void refresh(path)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        const key = sameRunner ? (activeSessionId ?? 'start-error') : 'start-error'
        failSessionView(key, reason)
        setActiveSessionId(key)
      }
    },
    [
      activeProjectPath,
      activeSessionId,
      agentName,
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
      const selectedRunnerId = nextRunnerId ?? selectedSession?.runnerId ?? activeProjectRunnerId
      if (selectedRunnerId && runners.some(({ id }) => id === selectedRunnerId)) {
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
        setActiveSessionId(id)
        setSelectedArtifact(undefined)
        void refresh(target.projectPath)
      } catch (error) {
        failSessionView(
          sessionId,
          error instanceof Error ? error.message : String(error),
        )
      }
    },
    [
      attachments,
      failSessionView,
      refresh,
      runners,
      setActiveSessionId,
      setAttachments,
      setSelectedArtifact,
    ],
  )

  const startFreshSession = useCallback(
    async ({ runnerId, cwd, prompt, agentName: freshAgent }: FreshSessionOptions): Promise<boolean> => {
      const runner = runners.find(({ id }) => id === runnerId)
      if (!runner) return false
      try {
        const id = await window.api.startSession({ runner, cwd, prompt, agentName: freshAgent })
        setActiveSessionId(id)
        setSelectedArtifact(undefined)
        void refresh(cwd)
        return true
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        failSessionView('start-error', reason)
        setActiveSessionId('start-error')
        return false
      }
    },
    [failSessionView, refresh, runners, setActiveSessionId, setSelectedArtifact],
  )

  return { chooseRunner, startFreshSession, submit, submitToSession }
}
