import { app } from 'electron'
import { join } from 'node:path'
import type { DetectedRunner } from '@shared/session'
import { runnerShell } from '@shared/runner'

/** 호스트 경로 → 러너 환경에서 통하는 경로 */
export function toRunnerPath(hostPath: string, runner: DetectedRunner): string {
  if (runner.kind !== 'wsl') return hostPath
  // C:\a\b → /mnt/c/a/b
  return hostPath
    .replace(/^([A-Za-z]):/, (_m, drive: string) => `/mnt/${drive.toLowerCase()}`)
    .replace(/\\/g, '/')
}

/**
 * 승인 요청 폴더. run 단위로 나눠 보조 Agent 의 요청과 섞이지 않게 한다.
 *
 * runId 는 `<session>:lead` 처럼 `:` 를 담는데 Windows 경로에는 쓸 수 없다
 * (`이름:lead` 는 대체 데이터 스트림 문법이라 mkdir 이 ENOENT 로 실패한다).
 * id 자체는 DB 키이자 이벤트 라우팅 값이라 그대로 두고, 폴더 이름일 때만 바꾼다.
 */
export function approvalDirOf(cwd: string, sessionId: string, runId: string): string {
  return join(cwd, '.agent-workspace', 'approvals', pathSegment(sessionId), pathSegment(runId))
}

/** 어느 플랫폼에서도 폴더 이름으로 쓸 수 있게 예약 문자를 바꾼다. */
export function pathSegment(id: string): string {
  // eslint-disable-next-line no-control-regex
  return id.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
}

/** 번들된 hook 스크립트의 호스트 경로 */
export function hookScriptHostPath(runner: DetectedRunner): string {
  const file = runnerShell(runner, process.platform) === 'posix' ? 'approve.sh' : 'approve.ps1'
  const base = app.isPackaged
    ? join(process.resourcesPath, 'hooks')
    : join(app.getAppPath(), 'resources', 'hooks')
  return join(base, file)
}

/**
 * hook 실행 명령 문자열. Claude Code 는 이 문자열을 셸로 실행한다.
 * - WSL/macOS/Linux: 실행 비트에 기대지 않고 bash 로 직접 호출한다
 * - Windows: PowerShell -File
 */
export function hookCommand(runner: DetectedRunner, approvalDirHost: string): string {
  const script = toRunnerPath(hookScriptHostPath(runner), runner)
  const dir = toRunnerPath(approvalDirHost, runner)
  return runnerShell(runner, process.platform) === 'posix'
    ? `bash '${script}' '${dir}'`
    : `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" "${dir}"`
}
