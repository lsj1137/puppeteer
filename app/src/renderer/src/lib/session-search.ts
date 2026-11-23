import type { StoredProject, StoredSession } from '@shared/session'

/**
 * 명령 팔레트(Ctrl+Space)의 세션 검색 순서. 팔레트는 일치 결과를 앞에서부터 잘라 보여주므로,
 * 지금 보는 프로젝트의 세션을 먼저, 다른 프로젝트는 최근 순으로, 숨긴 세션은 맨 뒤에 둔다.
 */
export function orderForSearch(sessions: StoredSession[], activeProjectPath?: string): StoredSession[] {
  const rank = (session: StoredSession): number =>
    (session.hidden ? 2 : 0) + (session.projectPath === activeProjectPath ? 0 : 1)
  return [...sessions].sort((a, b) => rank(a) - rank(b) || b.startedAt - a.startedAt)
}

/** 다른 프로젝트·숨긴 세션은 어디 있는 건지 같이 보여야 고를 수 있다. */
export function searchHint(
  session: StoredSession,
  projects: StoredProject[],
  activeProjectPath: string | undefined,
  time: string,
): string {
  const parts: string[] = []
  if (session.projectPath !== activeProjectPath) {
    const project = projects.find((p) => p.path === session.projectPath)
    parts.push(project?.alias || session.projectPath.split(/[\\/]/).filter(Boolean).pop() || session.projectPath)
  }
  if (session.hidden) parts.push('숨김')
  parts.push(time)
  return parts.join(' · ')
}
