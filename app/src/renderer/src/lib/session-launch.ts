import type { StoredSession } from '@shared/session'
import { sessionRunPath } from './navigation'

export interface SessionLaunch {
  path?: string
  resumeCliSessionId?: string
  continueSessionId?: string
  sameRunner: boolean
}

/** 현재 탭을 이어갈지 새 CLI 세션으로 시작할지 결정한다. */
export function resolveSessionLaunch(
  runnerId: string,
  activeSessionId: string | undefined,
  selectedSession: StoredSession | undefined,
  activeProjectPath: string | undefined,
  cwd?: string,
): SessionLaunch {
  const path = sessionRunPath(cwd, selectedSession?.projectPath, activeProjectPath)
  const sameRunner = !selectedSession || selectedSession.runnerId === runnerId
  const resumeCliSessionId = sameRunner ? (selectedSession?.cliSessionId ?? undefined) : undefined
  return {
    path,
    sameRunner,
    resumeCliSessionId,
    continueSessionId: resumeCliSessionId ? activeSessionId : undefined,
  }
}
