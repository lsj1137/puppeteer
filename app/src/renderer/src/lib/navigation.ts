import type { ApprovalRequest } from '@shared/session'

/** 승인 실행 cwd가 worktree여도 앱에서는 원본 프로젝트의 세션으로 이동한다. */
export function approvalNavigationPath(approval: ApprovalRequest): string {
  return approval.projectPath ?? approval.cwd
}

/** 기존 세션을 이어갈 때는 화면 상태보다 저장된 원본 프로젝트 경로를 우선한다. */
export function sessionRunPath(
  explicitPath: string | undefined,
  sessionProjectPath: string | undefined,
  activeProjectPath: string | undefined,
): string | undefined {
  return explicitPath ?? sessionProjectPath ?? activeProjectPath
}
