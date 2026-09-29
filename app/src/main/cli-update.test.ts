import { describe, expect, it } from 'vitest'
import type { DetectedRunner } from '@shared/session'
import { outputTail, plan, updateCommand, updateStep } from './cli-update'

function runner(overrides: Partial<DetectedRunner> = {}): DetectedRunner {
  return {
    id: 'wsl:Ubuntu:claude-cli',
    kind: 'wsl',
    provider: 'claude-cli',
    distro: 'Ubuntu',
    executable: '/home/dev/.bun/bin/claude',
    installMethod: 'bun',
    available: true,
    ...overrides,
  }
}

describe('updateStep', () => {
  it('bun 설치본은 실행 파일 옆의 bun 으로 올린다', () => {
    // 바 `bun`·`npm` 을 부르면 WSL 안에서도 Windows 쪽 도구가 잡힐 수 있다.
    expect(updateStep(runner())).toEqual({
      executable: '/home/dev/.bun/bin/bun',
      args: ['add', '-g', '@anthropic-ai/claude-code@latest'],
    })
  })

  it('Windows bun 설치본은 bun.exe 를 쓴다', () => {
    const step = updateStep(
      runner({
        kind: 'windows-native',
        executable: 'C:\\Users\\dev\\.bun\\bin\\claude.exe',
      }),
    )
    expect(step).toEqual({
      executable: 'C:\\Users\\dev\\.bun\\bin\\bun.exe',
      args: ['add', '-g', '@anthropic-ai/claude-code@latest'],
    })
  })

  it('npm·네이티브 Claude 는 CLI 자신의 update 명령을 쓴다', () => {
    const exe = 'C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd'
    expect(updateStep(runner({ kind: 'windows-native', executable: exe, installMethod: 'npm' }))).toEqual({
      executable: exe,
      args: ['update'],
    })
    expect(updateStep(runner({ kind: 'posix', executable: '/home/dev/.local/bin/claude', installMethod: 'native' }))).toEqual({
      executable: '/home/dev/.local/bin/claude',
      args: ['update'],
    })
  })

  it('npm Codex 는 WSL 이면 실행 파일 옆 npm, Windows 면 PATH 의 npm.cmd 를 쓴다', () => {
    expect(
      updateStep(runner({ provider: 'codex-cli', executable: '/home/dev/.npm-global/bin/codex', installMethod: 'npm' })),
    ).toEqual({ executable: '/home/dev/.npm-global/bin/npm', args: ['install', '-g', '@openai/codex@latest'] })
    expect(
      updateStep(
        runner({
          provider: 'codex-cli',
          kind: 'windows-native',
          executable: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
          installMethod: 'npm',
        }),
      ),
    ).toEqual({ executable: 'npm.cmd', args: ['install', '-g', '@openai/codex@latest'] })
  })

  it('앱 번들 Codex 나 테스트 러너는 올리지 않고 이유를 준다', () => {
    expect(updateStep(runner({ provider: 'codex-cli', installMethod: 'native' }))).toHaveProperty('unsupported')
    expect(updateStep(runner({ kind: 'custom' }))).toHaveProperty('unsupported')
  })
})

describe('plan', () => {
  it('WSL 은 어느 배포판에서 도는지 함께 보여준다', () => {
    expect(plan(runner())).toEqual({
      command: '[WSL Ubuntu] /home/dev/.bun/bin/bun add -g @anthropic-ai/claude-code@latest',
    })
  })
})

describe('updateCommand', () => {
  it('WSL 은 세션 실행과 같이 셸 평가 없이(-e) 절대경로로 띄운다', () => {
    const built = updateCommand(runner(), 'win32')
    expect(built?.command).toBe('wsl.exe')
    expect(built?.args).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '~',
      '-e',
      'bash',
      '-lc',
      'exec "$0" "$@"',
      '/home/dev/.bun/bin/bun',
      'add',
      '-g',
      '@anthropic-ai/claude-code@latest',
    ])
  })

  it('Windows .cmd 는 cmd.exe 로 감싼다', () => {
    const built = updateCommand(
      runner({ kind: 'windows-native', executable: 'C:\\npm\\claude.cmd', installMethod: 'npm' }),
      'win32',
    )
    expect(built?.windowsVerbatimArguments).toBe(true)
    expect(built?.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
  })
})

describe('outputTail', () => {
  it('색 코드를 걷고 빈 줄을 버린 뒤 끝부분만 남긴다', () => {
    const raw = ['\x1b[32minstalled\x1b[0m', '', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)].join('\r\n')
    const tail = outputTail(raw, 3)
    expect(tail).toBe('line 17\nline 18\nline 19')
    expect(outputTail('\x1b[32mok\x1b[0m')).toBe('ok')
  })
})
