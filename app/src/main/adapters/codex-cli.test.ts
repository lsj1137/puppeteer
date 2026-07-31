import { describe, expect, it } from 'vitest'
import { buildCodexArgs } from './codex-cli'
import { buildRunnerCommand } from './claude-cli'
import type { DetectedRunner } from '@shared/session'

describe('buildCodexArgs', () => {
  it('keeps exec options before a resume subcommand', () => {
    const args = buildCodexArgs({
      prompt: 'continue this',
      resumeSessionId: 'session-1',
      hookCommand: 'bash approve.sh /tmp/approvals',
    })

    expect(args.slice(0, 4)).toEqual(['exec', '--json', '--skip-git-repo-check', '--sandbox'])
    expect(args).toContain('--dangerously-bypass-hook-trust')
    expect(args.at(-3)).toBe('resume')
    expect(args.at(-2)).toBe('session-1')
    expect(args.at(-1)).toBe('continue this')
  })

  it('starts a new exec session without resume', () => {
    expect(buildCodexArgs({ prompt: 'hello' })).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      'hello',
    ])
  })

  it('keeps Codex args intact when wrapped for WSL', () => {
    const runner: DetectedRunner = {
      id: 'wsl:Ubuntu:codex-cli',
      kind: 'wsl',
      provider: 'codex-cli',
      distro: 'Ubuntu',
      executable: '/home/me/.npm-global/bin/codex',
      installMethod: 'npm',
      available: true,
    }

    const cliArgs = buildCodexArgs({ prompt: 'continue', resumeSessionId: 'session-1' })
    const command = buildRunnerCommand(runner, 'C:\\repo', cliArgs)

    expect(command.command).toBe('wsl.exe')
    expect(command.args.slice(0, 6)).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      'C:\\repo',
      '--',
      '/home/me/.npm-global/bin/codex',
    ])
    expect(command.args.slice(6)).toEqual(cliArgs)
  })
})
