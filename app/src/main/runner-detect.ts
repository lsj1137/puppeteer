import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { DetectedRunner, InstallMethod, ProviderId } from '@shared/session'

const exec = promisify(execFile)

/** 실행 경로로 설치 방식을 추정한다. bun 설치본이 불안정한 사례가 있어 구분해 표시한다. */
/**
 * WSL 홈을 Windows 에서 접근할 수 있는 UNC 경로로.
 * `\\wsl.localhost\<배포판>\home\<user>` — Win10 이후에서 동작한다.
 */
async function wslHome(distro: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('wsl.exe', ['-d', distro, '--', 'sh', '-c', 'echo $HOME'])
    const home = stdout.trim().split(/\r?\n/)[0]
    if (!home?.startsWith('/')) return undefined
    return `\\\\wsl.localhost\\${distro}${home.replace(/\//g, '\\')}`
  } catch {
    return undefined
  }
}

function guessInstallMethod(executable: string): InstallMethod {
  const p = executable.toLowerCase()
  if (p.includes('.bun')) return 'bun'
  if (p.includes('npm') || p.includes('node_modules')) return 'npm'
  if (!p) return 'unknown'
  return 'native'
}

async function tryVersion(cmd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await exec(cmd, args, { timeout: 10_000, windowsHide: true })
    // "2.1.220 (Claude Code)" → "2.1.220"
    return stdout
      .trim()
      .split(/\s+/)
      .find((token) => /^v?\d+\.\d+/.test(token))
      ?.replace(/^v/, '')
  } catch {
    return undefined
  }
}

/** Windows PATH 상의 실행 파일 탐지 */
async function detectWindows(provider: ProviderId, bin: string): Promise<DetectedRunner[]> {
  if (process.platform !== 'win32') return []
  try {
    const { stdout } = await exec('where', [bin], { timeout: 10_000, windowsHide: true })
    // where 는 셸 래퍼(claude)와 .cmd 를 함께 반환한다. 실행 가능한 .cmd 를 우선한다.
    const paths = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const executable = paths.find((p) => p.toLowerCase().endsWith('.cmd')) ?? paths[0]
    if (!executable) return []
    return [
      {
        id: `win:${provider}`,
        kind: 'windows-native',
        provider,
        executable,
        version: await tryVersion(executable, ['--version']),
        installMethod: guessInstallMethod(executable),
        available: true,
      },
    ]
  } catch {
    return []
  }
}

/** 설치된 WSL 배포판 목록. wsl.exe -l -q 는 UTF-16LE 로 출력한다. */
async function listWslDistros(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  try {
    const { stdout } = await exec('wsl.exe', ['-l', '-q'], {
      timeout: 15_000,
      windowsHide: true,
      encoding: 'buffer',
    })
    return Buffer.from(stdout as unknown as Buffer)
      .toString('utf16le')
      .split(/\r?\n/)
      .map((s) => s.replace(/\0/g, '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

async function detectWsl(provider: ProviderId, bin: string): Promise<DetectedRunner[]> {
  const distros = await listWslDistros()
  const found: DetectedRunner[] = []

  for (const distro of distros) {
    try {
      const { stdout } = await exec(
        'wsl.exe',
        ['-d', distro, '--', 'bash', '-lc', `command -v ${bin}`],
        { timeout: 15_000, windowsHide: true },
      )
      const executable = stdout.trim().split(/\r?\n/)[0]
      if (!executable) continue

      // 이 배포판의 홈. Windows 쪽에서 파일을 직접 읽고 쓰려면 UNC 가 필요하다.
      const home = await wslHome(distro)

      let version: string | undefined
      try {
        const v = await exec(
          'wsl.exe',
          ['-d', distro, '--', 'bash', '-lc', `${bin} --version`],
          { timeout: 15_000, windowsHide: true },
        )
        version = v.stdout.trim().split(/\s+/)[0] || undefined
      } catch {
        version = undefined
      }

      found.push({
        id: `wsl:${distro}:${provider}`,
        kind: 'wsl',
        provider,
        distro,
        executable,
        home,
        version,
        installMethod: guessInstallMethod(executable),
        available: true,
      })
    } catch {
      // 해당 배포판에 미설치 — 무시
    }
  }
  return found
}

/** 리눅스/맥에서 앱을 직접 실행하는 경우 */
async function detectPosix(provider: ProviderId, bin: string): Promise<DetectedRunner[]> {
  if (process.platform === 'win32') return []
  for (const shell of posixShells()) {
    try {
      const { stdout } = await exec(shell, ['-lc', `command -v ${bin}`], { timeout: 10_000 })
      const executable = stdout.trim().split(/\r?\n/)[0]
      if (!executable) continue
      return [
        {
          id: `posix:${provider}`,
          kind: 'posix',
          provider,
          executable,
          version: await tryVersion(executable, ['--version']),
          installMethod: guessInstallMethod(executable),
          available: true,
        },
      ]
    } catch {
      // 다음 셸로 재시도한다. macOS 는 zsh 설정에만 CLI 경로가 잡힌 경우가 흔하다.
    }
  }

  for (const executable of posixFallbackExecutables(provider, bin)) {
    if (!existsSync(executable)) continue
    return [
      {
        id: `posix:${provider}`,
        kind: 'posix',
        provider,
        executable,
        version: await tryVersion(executable, ['--version']),
        installMethod: guessInstallMethod(executable),
        available: true,
      },
    ]
  }
  return []
}

export function posixShells(shell = process.env.SHELL): string[] {
  return [...new Set([shell, 'zsh', 'bash'].filter((s): s is string => !!s))]
}

export function posixFallbackExecutables(
  provider: ProviderId,
  bin: string,
  home = homedir(),
  platform = process.platform,
  arch = process.arch,
): string[] {
  const candidates = [
    join(home, '.local', 'bin', bin),
    join(home, '.npm-global', 'bin', bin),
    join(home, '.bun', 'bin', bin),
    join(home, '.cargo', 'bin', bin),
    join(home, '.npm', 'bin', bin),
    `/opt/homebrew/bin/${bin}`,
    `/usr/local/bin/${bin}`,
  ]

  if (provider === 'codex-cli') {
    const platformDir = codexPlatformDir(platform, arch)
    if (platformDir) {
      for (const root of extensionRoots(home)) {
        candidates.push(...openAiExtensionDirs(root).map((dir) => join(dir, 'bin', platformDir, bin)))
      }
    }
  }

  return [...new Set(candidates)]
}

export function codexPlatformDir(platform: string, arch: string): string | undefined {
  if (platform === 'darwin') return arch === 'arm64' ? 'macos-aarch64' : 'macos-x64'
  if (platform === 'linux') return arch === 'arm64' ? 'linux-aarch64' : 'linux-x64'
  return undefined
}

function extensionRoots(home: string): string[] {
  return [
    join(home, '.vscode', 'extensions'),
    join(home, '.vscode-insiders', 'extensions'),
    join(home, '.cursor', 'extensions'),
    join(home, '.windsurf', 'extensions'),
  ]
}

function openAiExtensionDirs(root: string): string[] {
  try {
    return readdirSync(root)
      .filter((name) => name.startsWith('openai.chatgpt-'))
      .map((name) => join(root, name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  } catch {
    return []
  }
}

const TARGETS: Array<{ provider: ProviderId; bin: string }> = [
  { provider: 'claude-cli', bin: 'claude' },
  { provider: 'codex-cli', bin: 'codex' },
]

export async function detectRunners(): Promise<DetectedRunner[]> {
  const results = await Promise.all(
    TARGETS.flatMap(({ provider, bin }) => [
      detectWindows(provider, bin),
      detectWsl(provider, bin),
      detectPosix(provider, bin),
    ]),
  )
  return results.flat()
}
