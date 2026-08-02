import { describe, expect, it } from 'vitest'
import type { DetectedRunner } from '@shared/session'
import { buildClaudeArgs, buildRunnerCommand } from './claude-cli'

function runner(overrides: Partial<DetectedRunner> = {}): DetectedRunner {
  return {
    id: 'posix:claude-cli',
    kind: 'posix',
    provider: 'claude-cli',
    executable: '/opt/homebrew/bin/claude',
    installMethod: 'npm',
    available: true,
    ...overrides,
  }
}

describe('buildClaudeArgs', () => {
  it('starts a new stream-json session with the prompt first', () => {
    expect(buildClaudeArgs({ prompt: 'hello' })).toEqual([
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--verbose',
    ])
  })

  it('keeps resume and session-scoped settings in CLI args', () => {
    const args = buildClaudeArgs({
      prompt: 'continue this',
      resumeSessionId: 'session-1',
      hookCommand: 'bash approve.sh /tmp/approvals',
      agentsJson: '{"agents":[]}',
      agentName: 'reviewer',
      allowedTools: ['Read', 'Grep'],
      disallowedTools: ['Bash'],
    })

    expect(args.slice(0, 7)).toEqual([
      '-p',
      'continue this',
      '--output-format',
      'stream-json',
      '--verbose',
      '--resume',
      'session-1',
    ])
    expect(args).toContain('--agents')
    expect(args).toContain('{"agents":[]}')
    expect(args).toContain('--agent')
    expect(args).toContain('reviewer')
    expect(args).toContain('--allowedTools')
    expect(args).toContain('Read Grep')
    expect(args).toContain('--disallowedTools')
    expect(args).toContain('Bash')

    const settings = JSON.parse(args[args.indexOf('--settings') + 1]) as {
      hooks: { PreToolUse: { matcher: string; hooks: { command: string; timeout: number }[] }[] }
    }
    expect(settings.hooks.PreToolUse[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bash approve.sh /tmp/approvals',
      timeout: 300,
    })
  })
})

describe('buildRunnerCommand', () => {
  it('runs WSL runners through wsl.exe with the detected absolute executable', () => {
    const cliArgs = buildClaudeArgs({ prompt: 'hello' })
    const command = buildRunnerCommand(
      runner({
        id: 'wsl:Ubuntu:claude-cli',
        kind: 'wsl',
        distro: 'Ubuntu',
        executable: '/home/me/.npm-global/bin/claude',
      }),
      'C:\\repo',
      cliArgs,
    )

    expect(command.command).toBe('wsl.exe')
    expect(command.args.slice(0, 6)).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      'C:\\repo',
      '--',
      '/home/me/.npm-global/bin/claude',
    ])
    expect(command.args.slice(6)).toEqual(cliArgs)
  })

  it('wraps Windows native npm shims with cmd.exe on Windows hosts', () => {
    const cliArgs = buildClaudeArgs({ prompt: 'hello' })
    const command = buildRunnerCommand(
      runner({
        id: 'windows-native:claude-cli',
        kind: 'windows-native',
        executable: 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd',
      }),
      'C:\\repo',
      cliArgs,
      'win32',
    )

    expect(command).toEqual({
      command: 'cmd.exe',
      args: ['/c', 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd', ...cliArgs],
    })
  })
})
