import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DetectedRunner } from '@shared/session'
import {
  claudeConfigPath,
  codexModelsCachePath,
  list,
  parseClaudeModels,
  parseCodexModels,
} from './models'

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
          {
            slug: 'gpt-5.6-terra',
            display_name: 'GPT-5.6-Terra',
            description: 'Balanced agentic coding model for everyday work.',
            visibility: 'list',
          },
          { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide' },
        ],
      }),
    )

    // CLI 에 넘기는 값은 표시 이름(Terra)이 아니라 슬러그다. 아는 슬러그면 설명을 한글로 바꾼다.
    expect(options).toEqual([
      { value: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', detail: '일상 작업용 균형 잡힌 에이전트 코딩 모델' },
    ])
  })

  it('모르는 슬러그는 설명을 지어내지 않고 원문을 그대로 쓴다', () => {
    const options = parseCodexModels(
      JSON.stringify({
        models: [
          { slug: 'gpt-9-unknown', display_name: 'Future', description: 'Something new.', visibility: 'list' },
        ],
      }),
    )
    expect(options[0]).toMatchObject({ value: 'gpt-9-unknown', detail: 'Something new.' })
  })

  it('표시 이름이 비어 있으면 슬러그를 그대로 쓴다', () => {
    const options = parseCodexModels(
      JSON.stringify({ models: [{ slug: 'gpt-5.5', display_name: '  ', visibility: 'list' }] }),
    )
    expect(options[0]).toMatchObject({ value: 'gpt-5.5', label: 'gpt-5.5' })
  })
})

describe('parseClaudeModels', () => {
  it('CLI 가 캐시한 추가 모델을 후보로 만든다', () => {
    const options = parseClaudeModels(
      JSON.stringify({
        additionalModelOptionsCache: [
          {
            value: 'claude-fable-5-1[1m]',
            label: 'Fable',
            description: 'Fable 5.1 · Most capable for your hardest tasks',
          },
        ],
      }),
    )

    // 값은 CLI 가 준 그대로 넘긴다. `[1m]` 같은 꼬리표도 CLI 가 해석하는 부분이라 건드리지 않는다.
    expect(options).toEqual([
      {
        value: 'claude-fable-5-1[1m]',
        label: 'Fable',
        detail: 'Fable 5.1 · Most capable for your hardest tasks',
      },
    ])
  })

  it('CLI 버전이 낮아 못 쓰는 모델은 이유를 달아 못 고르게 표시한다', () => {
    const options = parseClaudeModels(
      JSON.stringify({
        additionalModelOptionsCache: [
          {
            value: 'cc-update-required-1',
            label: 'Opus 5.5 (disabled)',
            description: 'Update to 2.1.280+ to use Opus 5.5',
            disabled: true,
          },
        ],
      }),
    )

    // 라벨의 "(disabled)" 는 화면이 따로 표시하므로 뗀다. 이유는 그대로 남긴다.
    expect(options).toEqual([
      {
        value: 'cc-update-required-1',
        label: 'Opus 5.5',
        detail: 'Update to 2.1.280+ to use Opus 5.5',
        disabled: true,
      },
    ])
  })

  it('캐시가 비어 있으면 후보를 만들지 않는다', () => {
    expect(parseClaudeModels(JSON.stringify({ numStartups: 3 }))).toEqual([])
  })
})

describe('list', () => {
  it('Claude 는 설정이 없어도 버전이 올라가도 유효한 별칭을 준다', () => {
    const { options, note } = list(
      runner({ provider: 'claude-cli', kind: 'wsl', home: '/nonexistent-home' }),
    )
    expect(options.map((option) => option.value)).toEqual(['opus', 'sonnet', 'haiku'])
    // 설정 파일이 없는 건 CLI 를 아직 안 돌린 정상 상태다. 경고로 키우지 않는다.
    expect(note).toBeUndefined()
  })

  it('Claude 는 별칭 뒤에 CLI 캐시의 추가 모델을 붙이고 못 쓰는 항목은 맨 뒤로 보낸다', () => {
    const home = mkdtempSync(join(tmpdir(), 'claude-home-'))
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        additionalModelOptionsCache: [
          { value: 'cc-update-required-1', label: 'Opus 5.5 (disabled)', disabled: true },
          { value: 'claude-fable-5-1[1m]', label: 'Fable' },
          // 별칭과 겹치는 항목은 두 번 보여주지 않는다.
          { value: 'opus', label: 'Opus' },
        ],
      }),
    )

    const { options, source } = list(runner({ provider: 'claude-cli', kind: 'wsl', home }))
    expect(options.map((option) => option.value)).toEqual([
      'opus',
      'sonnet',
      'haiku',
      'claude-fable-5-1[1m]',
      'cc-update-required-1',
    ])
    expect(source).toBe(join(home, '.claude.json'))
  })

  it('Claude 설정이 깨져 있으면 이유를 남기되 별칭은 남겨 둔다', () => {
    const home = mkdtempSync(join(tmpdir(), 'claude-home-'))
    writeFileSync(join(home, '.claude.json'), '{ not json')

    const { options, note } = list(runner({ provider: 'claude-cli', kind: 'wsl', home }))
    expect(options.map((option) => option.value)).toEqual(['opus', 'sonnet', 'haiku'])
    expect(note).toContain('추가 모델 목록을 읽지 못했습니다')
  })

  it('Claude 설정 경로는 러너 홈 기준이다', () => {
    const home = join('/home', 'dev')
    expect(claudeConfigPath(runner({ kind: 'wsl', home }))).toBe(join(home, '.claude.json'))
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
