import { app } from 'electron'
import { isAbsolute, join } from 'node:path'
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
 * **프로젝트 폴더가 아니라 앱 데이터 폴더에 둔다.** 예전에는 `<project>/.agent-workspace/approvals`
 * 였다. «프로젝트는 Windows·WSL 양쪽에서 같은 곳을 본다» 는 가정이었는데, 보안(DRM) 가상
 * 드라이브(X: 등)에서는 WSL 이 쓴 파일이 «성공» 하고도 사라졌다 — 훅이 남긴 요청을 앱이 못 봐
 * 자동 승인 세션인데도 Bash 가 280초 뒤 «응답 대기 시간 초과» 로 막혔다. 앱 데이터 폴더는 C: 라
 * WSL 에서도 항상 `/mnt/c` 로 보이고, 사용자 프로젝트에 흔적도 남기지 않는다.
 *
 * runId 는 `<session>:lead` 처럼 `:` 를 담는데 Windows 경로에는 쓸 수 없다
 * (`이름:lead` 는 대체 데이터 스트림 문법이라 mkdir 이 ENOENT 로 실패한다).
 * id 자체는 DB 키이자 이벤트 라우팅 값이라 그대로 두고, 폴더 이름일 때만 바꾼다.
 */
export function approvalDirOf(sessionId: string, runId: string, root = app.getPath('userData')): string {
  return join(root, 'approvals', pathSegment(sessionId), pathSegment(runId))
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

/**
 * 작업 폴더(worktree) 밖이지만 세션이 다뤄야 하는 폴더. CLI 의 `--add-dir` 로 넘긴다.
 *
 * Claude 는 작업 폴더 밖 Read·Glob·Grep 을 자체 권한 검사로 막는다. 앱은 `-p` 로 띄워 사람에게
 * 물을 수 없으므로 «묻지 않고 거부» 가 된다(앱이 안내한 스킬 경로를 앱 스스로 막던 실제 사례).
 * Codex 는 `workspace-write` 샌드박스가 밖 쓰기를 OS 수준에서 막는다.
 *
 * 상대 경로는 프로젝트 기준으로 푼다. 작업 폴더 자신·중복·빈 값은 뺀다.
 */
export function accessDirs(workCwd: string, projectPath: string, candidates: Array<string | undefined>): string[] {
  const key = (path: string): string => path.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
  const seen = new Set([key(workCwd)])
  const out: string[] = []
  for (const raw of candidates) {
    const trimmed = raw?.trim()
    if (!trimmed) continue
    const path = isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed) ? trimmed : join(projectPath, trimmed)
    if (seen.has(key(path))) continue
    seen.add(key(path))
    out.push(path)
  }
  return out
}
