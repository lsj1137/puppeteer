import type { StoredSession } from '@shared/session'
import { sessionRunPath } from './navigation'

export interface SessionLaunch {
  path?: string
  resumeCliSessionId?: string
  continueSessionId?: string
  sameRunner: boolean
}

/**
 * Agent 를 미리 고르지 않고 지시 내용으로 정하겠다는 표시.
 * 실제 Agent 이름과 섞이면 안 되므로 파일명으로 쓸 수 없는 형태를 쓴다.
 */
export const AUTO_AGENT = '__auto__'

/**
 * 자동 선택 라우터를 태워야 하는지.
 *
 * 세션이 이미 있으면 그 세션의 Agent 가 정본이라 라우팅할 일이 없다.
 * 즉 자동 선택은 새 세션의 첫 지시에서만 의미가 있다.
 */
export function shouldRouteAgent(
  pickedAgent: string | undefined,
  activeSessionId: string | undefined,
): boolean {
  return pickedAgent === AUTO_AGENT && !activeSessionId
}

/**
 * 지금 화면에 적용할 Agent.
 *
 * 세션이 열려 있으면 그 세션에 저장된 값이 정본이고, 새 세션 화면에서는 사용자가 이번에 고른 값을 쓴다.
 * 이동할 때마다 상태를 비우는 방식은 경로 하나만 빠뜨려도 고른 적 없는 Agent 가 다음 세션에
 * 그대로 딸려간다 — 실제로 `새 세션`과 세션 삭제 경로에서 그렇게 샜다.
 */
export function resolveSessionAgent(
  selectedSession: StoredSession | undefined,
  pickedAgent: string | undefined,
): string | undefined {
  if (!selectedSession) return pickedAgent
  return selectedSession.agentName ?? undefined
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
