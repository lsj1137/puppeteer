import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DetectedRunner } from '@shared/session'
import { codexModelsCachePath, list, parseCodexModels } from './models'

function runner(overrides: Partial<DetectedRunner> = {}): DetectedRunner {
  return {
    id: 'posix:codex-cli',
    kind: 'posix',
    provider: 'codex-cli',
    executable: '/usr/local/bin/codex',
    installMethod: 'npm',
    available: true,
    ...overrides,
  }
}

describe('parseCodexModels', () => {
  it('목록에 노출되는 모델만 슬러그 그대로 후보로 만든다', () => {
    const options = parseCodexModels(
      JSON.stringify({
        models: [
          { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', description: '균형', visibility: 'list' },
          { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list' },
          { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide' },
        ],
      }),
    )

    // CLI 에 넘기는 값은 표시 이름(Terra)이 아니라 슬러그다.
    expect(options).toEqual([
      { value: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', detail: '균형' },
      { value: 'gpt-5.6-luna', label: 'GPT-5.6-Luna', detail: undefined },
    ])
  })

  it('표시 이름이 비어 있으면 슬러그를 그대로 쓴다', () => {
    const options = parseCodexModels(
      JSON.stringify({ models: [{ slug: 'gpt-5.5', display_name: '  ', visibility: 'list' }] }),
    )
    expect(options[0]).toMatchObject({ value: 'gpt-5.5', label: 'gpt-5.5' })
  })
})

describe('list', () => {
  it('Claude 는 버전이 올라가도 유효한 별칭을 준다', () => {
    const { options, note } = list(runner({ provider: 'claude-cli' }))
    expect(options.map((option) => option.value)).toEqual(['opus', 'sonnet', 'haiku'])
    expect(note).toBeUndefined()
  })

  it('Codex 캐시를 읽지 못하면 후보를 지어내지 않고 이유를 남긴다', () => {
    const { options, note } = list(runner({ kind: 'wsl', home: '/nonexistent-home' }))
    expect(options).toEqual([])
    expect(note).toContain('직접 입력')
  })

  // WSL 홈은 Windows 에서 UNC 경로로 들어오므로 구분자는 OS 규칙을 따른다.
  it('WSL 러너는 자기 홈의 캐시를 본다', () => {
    const home = join('/home', 'dev')
    expect(codexModelsCachePath(runner({ kind: 'wsl', home }))).toBe(
      join(home, '.codex', 'models_cache.json'),
    )
  })
})
