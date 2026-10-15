import { describe, expect, it } from 'vitest'
import type { DetectedRunner } from '@shared/session'
import { runnerEnvironmentLabel } from '@shared/runner'
import { costUsd } from './adapters/claude-cli'
import { buildCodexArgs } from './adapters/codex-cli'
import {
  OLLAMA_URL,
  ollamaArgs,
  parseOllamaTags,
  pickOllamaModel,
  runnerEnv,
  withOllamaRunners,
} from './ollama'

function runner(overrides: Partial<DetectedRunner> = {}): DetectedRunner {
  return {
    id: 'win:claude-cli',
    kind: 'windows-native',
    provider: 'claude-cli',
    executable: 'C:\\npm\\claude.cmd',
    installMethod: 'npm',
    available: true,
    ...overrides,
  }
}

describe('runnerEnv', () => {
  it('Ollama 판 Claude 는 요청 주소를 Ollama 로 돌리고 모델 별칭도 고른 모델로 묶는다', () => {
    const env = runnerEnv(runner({ backend: 'ollama' }), 'qwen3-coder', { PATH: 'x' })
    expect(env).toMatchObject({
      PATH: 'x',
      ANTHROPIC_BASE_URL: OLLAMA_URL,
      ANTHROPIC_AUTH_TOKEN: 'ollama',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3-coder',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'qwen3-coder',
    })
    // Windows 러너는 WSLENV 를 건드릴 이유가 없다.
    expect(env.WSLENV).toBeUndefined()
  })

  it('WSL 은 WSLENV 에 이름을 올려야 리눅스 쪽에 넘어간다. 기존 값은 보존한다', () => {
    const env = runnerEnv(runner({ kind: 'wsl', distro: 'Ubuntu', backend: 'ollama' }), undefined, {
      WSLENV: 'USERPROFILE/p',
    })
    expect(env.WSLENV).toBe('USERPROFILE/p:ANTHROPIC_BASE_URL/u:ANTHROPIC_AUTH_TOKEN/u')
  })

  it('일반 러너와 Codex 는 환경을 바꾸지 않는다', () => {
    const base = { PATH: 'x' }
    expect(runnerEnv(runner(), 'opus', base)).toBe(base)
    expect(runnerEnv(runner({ provider: 'codex-cli', backend: 'ollama' }), 'm', base)).toBe(base)
  })
})

describe('Codex 인자', () => {
  it('Ollama 판은 --oss 를 exec 공통 옵션 자리(resume 앞)에 둔다', () => {
    const codex = runner({ provider: 'codex-cli', backend: 'ollama' })
    expect(ollamaArgs(codex)).toEqual(['--oss', '--local-provider', 'ollama'])
    const args = buildCodexArgs({ runner: codex, prompt: 'p', model: 'qwen3-coder', resumeSessionId: 's1' })
    expect(args.indexOf('--oss')).toBeGreaterThan(0)
    expect(args.indexOf('--oss')).toBeLessThan(args.indexOf('resume'))
    expect(args).toContain('qwen3-coder')
  })

  it('일반 Codex 는 그대로다', () => {
    expect(buildCodexArgs({ runner: runner({ provider: 'codex-cli' }), prompt: 'p' })).not.toContain('--oss')
  })
})

describe('parseOllamaTags', () => {
  it('로컬 모델은 크기·양자화를, 클라우드 모델은 외부 전송을 알린다', () => {
    const options = parseOllamaTags({
      models: [
        {
          name: 'qwen3-coder:latest',
          size: 18.6 * 1024 ** 3,
          details: { parameter_size: '30.5B', quantization_level: 'Q4_K_M' },
        },
        { name: 'gpt-oss:120b-cloud', remote_host: 'https://ollama.com:443' },
      ],
    })
    expect(options[0]).toEqual({
      value: 'qwen3-coder:latest',
      label: 'qwen3-coder:latest',
      detail: '로컬 · 30.5B · Q4_K_M · 18.6GB',
    })
    expect(options[1].detail).toContain('PC 밖으로')
  })

  it('형식이 틀리면 후보를 만들지 않는다', () => {
    expect(parseOllamaTags({})).toEqual([])
    expect(parseOllamaTags(null)).toEqual([])
  })
})

describe('pickOllamaModel', () => {
  const installed = ['gpt-oss:120b-cloud', 'qwen3-coder:latest', 'gemma4:31b']

  it('받아 둔 모델을 고르면 그대로 쓴다. 태그를 생략하면 latest 로 맞춘다', () => {
    expect(pickOllamaModel('gemma4:31b', installed)).toBe('gemma4:31b')
    expect(pickOllamaModel('qwen3-coder', installed)).toBe('qwen3-coder:latest')
  })

  it('없는 이름(CLI 기본·opus 등)이면 로컬 모델 중 첫 번째. 클라우드로는 넘어가지 않는다', () => {
    expect(pickOllamaModel(undefined, installed)).toBe('qwen3-coder:latest')
    expect(pickOllamaModel('opus', installed)).toBe('qwen3-coder:latest')
  })

  it('클라우드는 직접 골랐을 때만 쓴다', () => {
    expect(pickOllamaModel('gpt-oss:120b-cloud', installed)).toBe('gpt-oss:120b-cloud')
    expect(() => pickOllamaModel(undefined, ['gpt-oss:120b-cloud'])).toThrow('로컬')
  })

  it('받은 모델이 없으면 받는 방법을 알려준다', () => {
    expect(() => pickOllamaModel(undefined, [])).toThrow('ollama pull')
  })
})

describe('withOllamaRunners', () => {
  it('Ollama 에 붙는 러너마다 Ollama 판을 원래 러너 뒤에 덧붙인다', () => {
    const win = runner()
    const wsl = runner({ id: 'wsl:Ubuntu:claude-cli', kind: 'wsl', distro: 'Ubuntu' })
    const result = withOllamaRunners([win, wsl], (r) => r.kind === 'windows-native')
    expect(result.map((r) => r.id)).toEqual(['win:claude-cli', 'wsl:Ubuntu:claude-cli', 'win:claude-cli:ollama'])
    expect(result[2]).toMatchObject({ backend: 'ollama', executable: win.executable })
  })

  it('테스트 러너에는 붙이지 않는다', () => {
    expect(withOllamaRunners([runner({ kind: 'custom' })], () => true)).toHaveLength(1)
  })

  it('목록에서 일반 러너와 구분되는 이름을 쓴다', () => {
    expect(runnerEnvironmentLabel(runner({ backend: 'ollama' }))).toBe('Windows · Ollama')
    expect(runnerEnvironmentLabel(runner({ kind: 'wsl', distro: 'Ubuntu', backend: 'ollama' }))).toBe(
      'WSL Ubuntu · Ollama',
    )
  })
})

describe('costUsd', () => {
  it('Ollama 로 돈 턴은 CLI 가 지어낸 비용을 버리고 0 으로 센다', () => {
    expect(costUsd(0.0108, runner({ backend: 'ollama' }))).toBe(0)
  })

  it('일반 러너는 CLI 가 준 값을 그대로 쓴다', () => {
    expect(costUsd(0.42, runner())).toBe(0.42)
    expect(costUsd(undefined, runner())).toBe(0)
  })
})
