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
