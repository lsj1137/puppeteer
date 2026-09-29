import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DetectedRunner, ModelChoices, ModelOption } from '@shared/session'

/**
 * 세션에 지정할 수 있는 모델 후보.
 *
 * 양쪽 다 앱에 모델 슬러그를 박지 않는다. 목록은 실제로 바뀌고(2026-07 관측된
 * Codex `gpt-5.6-sol` 이 8월 목록에는 없다), 박아두면 새 모델이 나올 때마다
 * 앱을 고쳐야 한다. 그래서 각 CLI 가 스스로 갱신하는 캐시를 읽는다.
 * - Codex: `~/.codex/models_cache.json`
 * - Claude: `~/.claude.json` 의 `additionalModelOptionsCache`
 *
 * 차이는 실패했을 때다. Claude 는 `opus`/`sonnet`/`haiku` 별칭이 버전이 올라가도
 * 유효해서 캐시를 못 읽어도 그 별칭만으로 쓸 수 있다. Codex 는 대신할 별칭이 없어
 * 후보를 지어내지 않고 직접 입력만 남긴 뒤 이유를 화면에 돌려준다.
 */
const CLAUDE_ALIASES: ModelOption[] = [
  { value: 'opus', label: 'Opus', detail: '가장 깊은 추론이 필요한 작업용' },
  { value: 'sonnet', label: 'Sonnet', detail: '속도와 추론의 균형' },
  { value: 'haiku', label: 'Haiku', detail: '간단한 작업용 빠른 모델' },
]

/**
 * Codex 캐시의 설명은 영어다. 슬러그가 정확히 일치할 때만 한글로 바꾸고,
 * 모르는 모델은 지어내지 않고 원문을 그대로 보여준다.
 */
const CODEX_DESCRIPTIONS: Record<string, string> = {
  'gpt-5.6-terra': '일상 작업용 균형 잡힌 에이전트 코딩 모델',
  'gpt-5.6-luna': '빠르고 저렴한 에이전트 코딩 모델',
  'gpt-5.5': '복잡한 코딩·조사·실무를 위한 최상위 모델',
  'gpt-5.4-mini': '간단한 코딩 작업용 작고 빠른 저비용 모델',
}

interface ClaudeModelOption {
  value?: string
  label?: string
  description?: string
  /** CLI 버전이 낮아 아직 못 쓰는 모델. value 는 `cc-update-required-1` 같은 자리표시자다. */
  disabled?: boolean
}

interface ClaudeConfig {
  additionalModelOptionsCache?: ClaudeModelOption[]
}

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
    .map((model) => {
      const slug = model.slug as string
      return {
        value: slug,
        label: model.display_name?.trim() || slug,
        detail: CODEX_DESCRIPTIONS[slug] ?? model.description?.trim() ?? undefined,
      }
    })
}

export function claudeConfigPath(runner: DetectedRunner): string | undefined {
  const home = homeOf(runner)
  return home ? join(home, '.claude.json') : undefined
}

/**
 * Claude CLI 가 서버에서 받아 캐시해 둔 «추가 모델» 목록.
 * 별칭으로 가리킬 수 없는 신규 모델(Fable 5.1 등)이 여기로 온다.
 */
export function parseClaudeModels(raw: string): ModelOption[] {
  const parsed = JSON.parse(raw) as ClaudeConfig
  const extras = Array.isArray(parsed.additionalModelOptionsCache)
    ? parsed.additionalModelOptionsCache
    : []
  return extras
    .filter((extra): extra is ClaudeModelOption & { value: string } => !!extra?.value)
    .map((extra) => ({
      value: extra.value,
      // "Opus 5.5 (disabled)" — 못 쓰는 상태는 화면에서 따로 표시하므로 꼬리말을 뗀다.
      label: extra.label?.replace(/\s*\(disabled\)\s*$/i, '').trim() || extra.value,
      detail: extra.description?.trim() || undefined,
      ...(extra.disabled ? { disabled: true as const } : {}),
    }))
}

function listClaude(runner: DetectedRunner): ModelChoices {
  const path = claudeConfigPath(runner)
  if (!path) return { options: CLAUDE_ALIASES }

  let extras: ModelOption[]
  try {
    extras = parseClaudeModels(readFileSync(path, 'utf8'))
  } catch (e) {
    // 파일이 없는 건 CLI 를 아직 한 번도 안 돌린 정상 상태다. 별칭만으로도 쓸 수 있으니
    // 경고로 키우지 않고, 그 외 이유(깨진 JSON·권한)만 화면에 돌려준다.
    const code = (e as NodeJS.ErrnoException).code
    return code === 'ENOENT'
      ? { options: CLAUDE_ALIASES }
      : {
          options: CLAUDE_ALIASES,
          note: `추가 모델 목록을 읽지 못했습니다(${(e as Error).message}). 별칭은 그대로 쓸 수 있습니다.`,
        }
  }

  // 별칭과 겹치는 항목만 걸러낸다. 못 쓰는 항목은 value 가 자리표시자라 서로 겹칠 수 있어
  // 중복 제거 대상에서 빼고, 맨 뒤로 몰아 고를 수 있는 후보를 가린다.
  const aliasValues = new Set(CLAUDE_ALIASES.map((option) => option.value))
  const usable = extras.filter((option) => !option.disabled && !aliasValues.has(option.value))
  const blocked = extras.filter((option) => option.disabled)

  return {
    options: [...CLAUDE_ALIASES, ...usable, ...blocked],
    ...(extras.length > 0 ? { source: path } : {}),
  }
}

export function list(runner: DetectedRunner): ModelChoices {
  if (runner.provider !== 'codex-cli') {
    return listClaude(runner)
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
