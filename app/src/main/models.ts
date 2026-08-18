import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DetectedRunner, ModelChoices, ModelOption } from '@shared/session'

/**
 * 세션에 지정할 수 있는 모델 후보.
 *
 * Claude 는 `opus`/`sonnet`/`haiku` 별칭이 버전이 올라가도 유효해서 그대로 쓴다.
 * Codex 는 모델 목록이 실제로 바뀐다(2026-07 관측된 `gpt-5.6-sol` 이 8월 목록에는 없다).
 * 그래서 앱에 슬러그를 박지 않고 Codex CLI 가 스스로 갱신하는 캐시를 읽는다.
 * 읽지 못하면 후보를 지어내지 않고 직접 입력만 남긴 뒤 이유를 화면에 돌려준다.
 */
const CLAUDE_ALIASES: ModelOption[] = [
  { value: 'opus', label: 'Opus', detail: '가장 강한 추론' },
  { value: 'sonnet', label: 'Sonnet', detail: '균형' },
  { value: 'haiku', label: 'Haiku', detail: '빠름' },
]

interface CodexModelsCache {
  fetched_at?: string
  models?: Array<{
    slug?: string
    display_name?: string
    description?: string
    visibility?: string
  }>
}

/** WSL 러너는 자기 홈이 따로 있다. 나머지는 앱이 도는 호스트 홈을 쓴다. */
function homeOf(runner: DetectedRunner): string | undefined {
  return runner.kind === 'wsl' ? runner.home : homedir()
}

export function codexModelsCachePath(runner: DetectedRunner): string | undefined {
  const home = homeOf(runner)
  return home ? join(home, '.codex', 'models_cache.json') : undefined
}

export function parseCodexModels(raw: string): ModelOption[] {
  const parsed = JSON.parse(raw) as CodexModelsCache
  const models = Array.isArray(parsed.models) ? parsed.models : []
  return models
    // visibility 가 'list' 가 아닌 항목은 Codex 가 목록에 숨기는 내부 모델이다.
    .filter((model) => model.visibility === 'list' && typeof model.slug === 'string')
    .map((model) => ({
      value: model.slug as string,
      label: model.display_name?.trim() || (model.slug as string),
      detail: model.description?.trim() || undefined,
    }))
}

export function list(runner: DetectedRunner): ModelChoices {
  if (runner.provider !== 'codex-cli') {
    return { options: CLAUDE_ALIASES }
  }

  const path = codexModelsCachePath(runner)
  if (!path) {
    return { options: [], note: '이 실행 환경의 홈을 찾지 못해 모델 목록을 읽지 못했습니다.' }
  }

  try {
    const options = parseCodexModels(readFileSync(path, 'utf8'))
    if (options.length === 0) {
      return { options, note: `모델 캐시에 목록이 없습니다: ${path}` }
    }
    return { options, source: path }
  } catch (e) {
    return {
      options: [],
      note: `Codex 모델 캐시를 읽지 못했습니다(${(e as Error).message}). 슬러그를 직접 입력해 주세요.`,
    }
  }
}
