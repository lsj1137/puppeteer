import { describe, expect, it } from 'vitest'
import type { DetectedRunner, RunnerKind } from './session'
import { runnerEnvironmentLabel, runnerShell } from './runner'

function runner(kind: RunnerKind, distro?: string): DetectedRunner {
  return {
    id: `${kind}:claude-cli`,
    kind,
    provider: 'claude-cli',
    distro,
    executable: 'claude',
    installMethod: 'npm',
    available: true,
  }
}

describe('runner helpers', () => {
  it('uses bash-compatible hooks for WSL and POSIX runners', () => {
    expect(runnerShell(runner('wsl', 'Ubuntu'), 'win32')).toBe('posix')
    expect(runnerShell(runner('posix'), 'darwin')).toBe('posix')
  })

  it('keeps Windows native runners on PowerShell', () => {
    expect(runnerShell(runner('windows-native'), 'win32')).toBe('powershell')
    expect(runnerShell(runner('windows-native'), 'darwin')).toBe('powershell')
  })

  it('handles legacy custom runners by host platform', () => {
    expect(runnerShell(runner('custom'), 'win32')).toBe('powershell')
    expect(runnerShell(runner('custom'), 'darwin')).toBe('posix')
  })

  it('labels runner environments without calling POSIX Windows', () => {
    expect(runnerEnvironmentLabel(runner('wsl', 'Ubuntu'))).toBe('WSL Ubuntu')
    expect(runnerEnvironmentLabel(runner('windows-native'))).toBe('Windows')
    expect(runnerEnvironmentLabel(runner('posix'))).toBe('macOS/Linux')
    expect(runnerEnvironmentLabel(runner('custom'))).toBe('Custom')
  })
})
