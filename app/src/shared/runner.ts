import type { DetectedRunner } from './session'

export type RunnerShell = 'posix' | 'powershell'

export function runnerShell(runner: DetectedRunner, hostPlatform: string): RunnerShell {
  if (runner.kind === 'wsl' || runner.kind === 'posix') return 'posix'
  if (runner.kind === 'windows-native') return 'powershell'
  return hostPlatform === 'win32' ? 'powershell' : 'posix'
}

export function runnerEnvironmentLabel(runner: DetectedRunner): string {
  if (runner.kind === 'wsl') return `WSL${runner.distro ? ` ${runner.distro}` : ''}`
  if (runner.kind === 'windows-native') return 'Windows'
  if (runner.kind === 'posix') return 'macOS/Linux'
  return 'Custom'
}
