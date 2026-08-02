import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  codexPlatformDir,
  posixFallbackExecutables,
  posixShells,
  windowsFallbackExecutables,
} from './runner-detect'

describe('posixShells', () => {
  it('tries the user shell before common POSIX shells', () => {
    expect(posixShells('/bin/zsh')).toEqual(['/bin/zsh', 'zsh', 'bash'])
  })

  it('falls back to zsh and bash without duplicates', () => {
    expect(posixShells('zsh')).toEqual(['zsh', 'bash'])
    expect(posixShells('')).toEqual(['zsh', 'bash'])
  })
})

describe('posixFallbackExecutables', () => {
  it('includes common POSIX install locations', () => {
    expect(posixFallbackExecutables('claude-cli', 'claude', '/Users/me')).toEqual(
      expect.arrayContaining([
        '/Users/me/.local/bin/claude',
        '/Users/me/.npm-global/bin/claude',
        '/Users/me/.bun/bin/claude',
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
      ]),
    )
  })

  it('maps Codex extension platform directories', () => {
    expect(codexPlatformDir('darwin', 'arm64')).toBe('macos-aarch64')
    expect(codexPlatformDir('darwin', 'x64')).toBe('macos-x64')
    expect(codexPlatformDir('linux', 'arm64')).toBe('linux-aarch64')
    expect(codexPlatformDir('linux', 'x64')).toBe('linux-x64')
    expect(codexPlatformDir('win32', 'x64')).toBe('windows-x86_64')
    expect(codexPlatformDir('win32', 'arm64')).toBe('windows-aarch64')
  })
})

describe('windowsFallbackExecutables', () => {
  it('does not treat extension binaries as another provider', () => {
    expect(windowsFallbackExecutables('claude-cli', 'claude', 'C:\\Users\\me')).toEqual([])
  })

  it('includes the Windows Codex desktop app bundle', () => {
    const localAppData = mkdtempSync(join(tmpdir(), 'puppeteer-runner-detect-'))
    const binDir = join(localAppData, 'OpenAI', 'Codex', 'bin', 'version-hash')
    mkdirSync(binDir, { recursive: true })

    expect(windowsFallbackExecutables('codex-cli', 'codex', 'C:\\Users\\me', 'x64', localAppData)).toContain(
      join(binDir, 'codex.exe'),
    )
  })
})
