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
  // 구버전 세션은 runner_id가 비어 있을 수 있다. 프로젝트에서 복구한 실행환경을
  // 선택했다면 새 대화를 만들지 않고 기존 CLI 세션을 그대로 재개한다.
  const sameRunner = !selectedSession || !selectedSession.runnerId || selectedSession.runnerId === runnerId
  const resumeCliSessionId = sameRunner ? (selectedSession?.cliSessionId ?? undefined) : undefined
  return {
    path,
    sameRunner,
    resumeCliSessionId,
    continueSessionId: resumeCliSessionId ? activeSessionId : undefined,
  }
}
