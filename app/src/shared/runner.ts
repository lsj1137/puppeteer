import type { DetectedRunner } from './session'

export type RunnerShell = 'posix' | 'powershell'

export function runnerShell(runner: DetectedRunner, hostPlatform: string): RunnerShell {
  if (runner.kind === 'wsl' || runner.kind === 'posix') return 'posix'
  if (runner.kind === 'windows-native') return 'powershell'
  return hostPlatform === 'win32' ? 'powershell' : 'posix'
}

export function runnerEnvironmentLabel(runner: DetectedRunner): string {
  // 같은 CLI 라도 모델을 Ollama 에서 받으면 다른 실행 환경이다. 목록에서 둘이 구분돼야 한다.
  const backend = runner.backend === 'ollama' ? ' · Ollama' : ''
  if (runner.kind === 'wsl') return `WSL${runner.distro ? ` ${runner.distro}` : ''}${backend}`
  if (runner.kind === 'windows-native') return `Windows${backend}`
  if (runner.kind === 'posix') return `macOS/Linux${backend}`
  return `Custom${backend}`
}
