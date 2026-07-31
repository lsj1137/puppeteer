import { describe, expect, it } from 'vitest'
import { codexPlatformDir, posixFallbackExecutables, posixShells } from './runner-detect'

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
    expect(codexPlatformDir('win32', 'x64')).toBeUndefined()
  })
})
