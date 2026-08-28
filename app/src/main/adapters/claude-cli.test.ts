import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DetectedRunner } from '@shared/session'
import {
  buildClaudeArgs,
  buildClaudePrompt,
  buildRunnerCommand,
  escapeWindowsCmdArgument,
} from './claude-cli'

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
  it('keeps the potentially long prompt out of process arguments', () => {
    expect(buildClaudeArgs({ prompt: 'hello' })).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
    ])
  })

  // 예전에는 model 을 받고도 CLI 에 넘기지 않아 Agent 의 모델 지정이 조용히 무시됐다.
  it('passes the selected model to the CLI', () => {
    expect(buildClaudeArgs({ prompt: 'hello', model: 'opus' })).toContain('--model')
    expect(buildClaudeArgs({ prompt: 'hello', model: 'opus' })).toContain('opus')
    expect(buildClaudeArgs({ prompt: 'hello' })).not.toContain('--model')
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

    expect(args.slice(0, 6)).toEqual([
      '-p',
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

  it('sends system instructions and the user prompt through stdin', () => {
    const long = '긴 지침'.repeat(20_000)
    const prompt = buildClaudePrompt({ prompt: '계속해줘', systemPrompt: long })
    expect(prompt.startsWith(long)).toBe(true)
    expect(prompt.endsWith('계속해줘')).toBe(true)
    expect(buildClaudeArgs({ prompt: long })).not.toContain(long)
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
    expect(command.args.slice(0, 9)).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      'C:\\repo',
      // `--` 를 쓰면 명령이 로그인 셸에 실려 인자 안의 백틱이 실행된다
      '-e',
      'bash',
      '-lc',
      'exec "$0" "$@"',
      '/home/me/.npm-global/bin/claude',
    ])
    expect(command.args.slice(9)).toEqual(cliArgs)
  })

  it('WSL 인자를 셸에 노출하지 않는다 — 백틱이 든 Agent 지침이 실행되면 안 된다', () => {
    const dangerous = JSON.stringify({
      dev: { description: '`id`', prompt: '`kccai` 는 $(whoami) 가 아니다' },
    })
    const command = buildRunnerCommand(
      runner({ kind: 'wsl', distro: 'Ubuntu', executable: '/usr/bin/claude' }),
      'C:\\repo',
      buildClaudeArgs({ prompt: 'hi', agentsJson: dangerous }),
    )

    // 셸 스크립트 자리는 고정 문자열뿐이고, 위험한 텍스트는 별개 인자로만 존재한다
    expect(command.args).toContain('exec "$0" "$@"')
    expect(command.args).toContain(dangerous)
    expect(command.args.filter((a) => a.includes('$0'))).toHaveLength(1)
    expect(command.args).not.toContain('--')
  })

  it('시스템 프롬프트는 인자가 아니라 stdin 으로 간다', () => {
    const systemPrompt = '`AGENTS.md` 를 지켜라'
    expect(buildClaudeArgs({ prompt: '지시' }).join(' ')).not.toContain('AGENTS.md')
    expect(buildClaudePrompt({ prompt: '지시', systemPrompt })).toContain('`AGENTS.md`')
  })

  it('wraps Windows native npm shims with cmd.exe on Windows hosts', () => {
    const cliArgs = buildClaudeArgs({
      prompt: '한글 요청 & "quoted"',
      hookCommand: 'powershell approve.ps1',
    })
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

    expect(command.command.toLowerCase()).toMatch(/cmd\.exe$/)
    expect(command.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(command.windowsVerbatimArguments).toBe(true)
    expect(command.args[3]).toContain('claude.cmd')
    expect(command.args[3]).not.toContain('한글 요청')
    expect(buildClaudePrompt({ prompt: '한글 요청 & "quoted"' })).toBe('한글 요청 & "quoted"')
    const settings = cliArgs[cliArgs.indexOf('--settings') + 1]
    expect(settings).toContain('Bash|PowerShell|Write|Edit|NotebookEdit')
    expect(command.args[3]).toContain(escapeWindowsCmdArgument(settings))
  })

  it('escapes pipes, quotes, spaces, and Korean text before cmd shim parsing', () => {
    expect(escapeWindowsCmdArgument('{"matcher":"Bash|Edit"}')).toBe(
      '^^^"{\\^^^"matcher\\^^^":\\^^^"Bash^^^|Edit\\^^^"}^^^"',
    )
    expect(escapeWindowsCmdArgument('한글 & echo "ok"')).toContain('한글^^^ ^^^&')
    expect(escapeWindowsCmdArgument('한글 & echo "ok"')).toContain('\\^^^"ok\\^^^"')
  })

  it.runIf(process.platform === 'win32')(
    'preserves native .cmd arguments through a real cmd.exe round trip',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'puppeteer cmd regression '))
      try {
        const shim = join(dir, 'fake-cli.cmd')
        writeFileSync(
          join(dir, 'capture.mjs'),
          'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
        )
        writeFileSync(shim, '@echo off\r\nnode "%~dp0capture.mjs" %*\r\n')
        const expected = [
          '--settings',
          '{"matcher":"Bash|PowerShell|Write|Edit"}',
          '--prompt',
          '한글 요청 & "quoted"',
        ]
        const command = buildRunnerCommand(
          runner({ kind: 'windows-native', executable: shim }),
          dir,
          expected,
          'win32',
        )
        const result = spawnSync(command.command, command.args, {
          cwd: dir,
          encoding: 'utf8',
          windowsVerbatimArguments: command.windowsVerbatimArguments,
        })

        expect(result.status, result.stderr).toBe(0)
        expect(JSON.parse(result.stdout)).toEqual(expected)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it('places fixed executable args before CLI args without a shell', () => {
    const command = buildRunnerCommand(
      runner({ executable: 'C:\\Program Files\\nodejs\\node.exe', executableArgs: ['fake-cli.mjs'] }),
      'C:\\repo',
      ['--settings', '{"matcher":"Bash|Edit"}'],
      'win32',
    )

    expect(command).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['fake-cli.mjs', '--settings', '{"matcher":"Bash|Edit"}'],
    })
  })
})
