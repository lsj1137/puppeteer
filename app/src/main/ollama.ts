import type { DetectedRunner, ModelOption } from '@shared/session'

/**
 * Ollama 를 Claude·Codex CLI 의 모델 공급처로 붙인다.
 *
 * Ollama 를 새 provider 로 만들지 않는다. 도구 실행·파일 수정·승인·이어가기는 CLI 가 하고
 * 모델은 «다음에 뭘 할지» 만 답한다. 그래서 CLI 가 요청을 보낼 주소만 바꾸면 나머지는 그대로다.
 * - Claude: Ollama v0.14+ 가 Anthropic Messages API 형식을 받는다 → `ANTHROPIC_BASE_URL`
 * - Codex: `--oss --local-provider ollama` 가 내장돼 있다
 *
 * 주소는 **러너 쪽에서 본** `127.0.0.1:11434` 고정이다. Codex `--oss` 기본값과 같고,
 * 탐지도 러너 쪽에서 이 주소로 붙어지는지를 본다(WSL NAT 에서는 Windows 의 Ollama 가 안 보인다).
 */
export const OLLAMA_PORT = 11434
export const OLLAMA_URL = `http://127.0.0.1:${OLLAMA_PORT}`

export function isOllama(runner: DetectedRunner): boolean {
  return runner.backend === 'ollama'
}

/**
 * Claude CLI 를 Ollama 로 돌릴 환경변수.
 *
 * 모델 별칭(`opus`·`sonnet`·`haiku`)도 고른 모델로 돌린다. CLI 는 제목 생성 같은 뒷일을
 * 작은 모델 별칭으로 따로 요청하는데, Ollama 에는 그 이름의 모델이 없어 실패한다.
 *
 * WSL 은 Windows 프로세스의 환경변수를 그냥 물려받지 않는다. `WSLENV` 에 이름을 올려야 넘어간다.
 */
export function runnerEnv(
  runner: DetectedRunner,
  model: string | undefined,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!isOllama(runner) || runner.provider === 'codex-cli') return base

  const vars: Record<string, string> = {
    ANTHROPIC_BASE_URL: OLLAMA_URL,
    // 필수지만 Ollama 는 값을 보지 않는다(문서 기준).
    ANTHROPIC_AUTH_TOKEN: 'ollama',
  }
  if (model) {
    for (const alias of ['OPUS', 'SONNET', 'HAIKU']) vars[`ANTHROPIC_DEFAULT_${alias}_MODEL`] = model
    vars.ANTHROPIC_SMALL_FAST_MODEL = model
  }

  const env: NodeJS.ProcessEnv = { ...base, ...vars }
  if (runner.kind === 'wsl') {
    // `/u` — Windows 에서 WSL 을 띄울 때만 넘긴다.
    env.WSLENV = [base.WSLENV, ...Object.keys(vars).map((name) => `${name}/u`)].filter(Boolean).join(':')
  }
  return env
}

/** Codex 를 Ollama 로 돌릴 인자. `exec` 공통 옵션이라 `resume` 보다 앞에 와야 한다. */
export function ollamaArgs(runner: DetectedRunner): string[] {
  return isOllama(runner) && runner.provider === 'codex-cli' ? ['--oss', '--local-provider', 'ollama'] : []
}

interface OllamaTags {
  models?: Array<{
    name?: string
    size?: number
    remote_host?: string
    details?: { parameter_size?: string; quantization_level?: string }
  }>
}

/** `:cloud`·`-cloud` 모델은 Ollama 클라우드에서 돈다. 대화가 PC 밖으로 나간다. */
export function isCloudModel(name: string): boolean {
  return /[:-]cloud$/i.test(name)
}

export function parseOllamaTags(raw: unknown): ModelOption[] {
  const models = Array.isArray((raw as OllamaTags)?.models) ? (raw as OllamaTags).models! : []
  return models
    .filter((model): model is typeof model & { name: string } => typeof model?.name === 'string' && !!model.name)
    .map((model) => {
      const cloud = isCloudModel(model.name) || !!model.remote_host
      const facts = [
        model.details?.parameter_size,
        model.details?.quantization_level,
        !cloud && model.size ? `${(model.size / 1024 ** 3).toFixed(1)}GB` : undefined,
      ].filter(Boolean)
      return {
        value: model.name,
        label: model.name,
        detail: cloud
          ? 'Ollama 클라우드 모델 — 대화가 PC 밖으로 전송됩니다'
          : facts.length
            ? `로컬 · ${facts.join(' · ')}`
            : '로컬',
      }
    })
}

/**
 * 실제로 요청할 모델을 고른다.
 *
 * 고른 모델이 받아져 있으면 그대로, 아니면(«CLI 기본», Agent 에 적힌 `opus` 등) 받아 둔
 * **로컬** 모델 중 첫 번째. 클라우드 모델로는 몰래 넘어가지 않는다 — 사용자가 직접 골랐을 때만 쓴다.
 */
export function pickOllamaModel(requested: string | undefined, installed: string[]): string {
  const want = requested?.trim()
  if (want) {
    const hit = installed.find((name) => name === want || name === `${want}:latest`)
    if (hit) return hit
  }
  const local = installed.find((name) => !isCloudModel(name))
  if (local) return local
  if (installed.length) {
    throw new Error('받아 둔 로컬 Ollama 모델이 없습니다. 클라우드 모델을 쓰려면 모델 버튼에서 직접 골라 주세요.')
  }
  throw new Error('Ollama 에 받은 모델이 없습니다. `ollama pull <모델>` 로 먼저 받아 주세요.')
}

async function fetchTags(timeoutMs = 3_000): Promise<unknown> {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * 앱(호스트)에서 본 Ollama 모델 목록.
 * WSL 안에 띄운 Ollama 도 WSL 의 localhost 전달 덕에 호스트에서 같은 주소로 보인다.
 */
export async function listModels(): Promise<ModelOption[]> {
  return parseOllamaTags(await fetchTags())
}

export async function resolveModel(requested: string | undefined): Promise<string> {
  let installed: string[]
  try {
    installed = (await listModels()).map((option) => option.value)
  } catch (e) {
    // 목록을 못 읽어도 사용자가 이름을 줬다면 CLI 가 직접 시도하게 둔다. 실패하면 CLI 가 이유를 낸다.
    if (requested?.trim()) return requested.trim()
    throw new Error(`Ollama 모델 목록을 읽지 못했습니다(${(e as Error).message}). Ollama 가 켜져 있는지 확인해 주세요.`)
  }
  return pickOllamaModel(requested, installed)
}

/** 호스트에서 Ollama 가 응답하는지. 탐지를 늦추지 않게 짧게 끊는다. */
export async function probeHost(timeoutMs = 1_500): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 탐지된 CLI 러너마다 Ollama 판을 하나씩 덧붙인다. 원래 러너 뒤에 붙여 기본 선택이 바뀌지 않게 한다.
 * `reachable` 은 그 러너 쪽에서 Ollama 에 붙어지는지다(WSL 은 배포판 안에서 따로 본다).
 */
export function withOllamaRunners(
  runners: DetectedRunner[],
  reachable: (runner: DetectedRunner) => boolean,
): DetectedRunner[] {
  const extra = runners
    .filter((runner) => !isOllama(runner) && runner.kind !== 'custom' && reachable(runner))
    .map((runner): DetectedRunner => ({ ...runner, id: `${runner.id}:ollama`, backend: 'ollama' }))
  return [...runners, ...extra]
}
