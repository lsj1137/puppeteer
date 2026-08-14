import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { AgentDef, FetchedAgent, UpdateCheck } from '@shared/session'
import * as library from './agent-library'
import { parseAgentText } from './agent-library'

/**
 * 남이 만든 에이전트 가져오기.
 *
 * **가져오기는 다운로드가 아니라 검토다.** 에이전트 지침은 그 자체가 실행 지시이고,
 * `allowedTools` 에 Bash 가 들어 있으면 받는 순간 그대로 돈다.
 * 그래서 여기서는 **파싱만 하고 저장하지 않는다.** 저장은 사용자가 전문을 보고
 * 권한을 다시 정한 뒤에만 일어난다(렌더러의 검토 화면).
 */

export async function fetchFromUrl(raw: string): Promise<FetchedAgent> {
  const url = normalize(raw)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

  const text = await res.text()
  if (text.length > 512_000) throw new Error('파일이 너무 큽니다 (512KB 초과)')
  return toFetched(text, url, true)
}

export function fetchFromFile(path: string): FetchedAgent {
  // 로컬 파일은 나중에 다시 읽을 보장이 없으므로 연결 대상이 아니다
  return toFetched(readFileSync(path, 'utf8'), path, false)
}

function toFetched(text: string, source: string, linkable: boolean): FetchedAgent {
  const agent = parseAgentText(text)
  if (!agent) throw new Error('에이전트 형식이 아닙니다 (--- 프론트매터를 찾지 못했습니다)')
  if (!agent.name.trim()) throw new Error('name 이 비어 있습니다')

  return {
    // 적용 대상과 권한은 가져온 값을 그대로 쓰지 않는다. 사용자가 다시 정한다.
    agent: {
      ...agent,
      filePath: '',
      scope: 'library',
      projectPath: undefined,
      workspace: {
        ...agent.workspace,
        projects: undefined,
        allowedTools: undefined,
        disallowedTools: undefined,
        approvalMode: undefined,
      },
    },
    source,
    hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
    linkable,
    requested: {
      allowedTools: agent.workspace.allowedTools ?? [],
      disallowedTools: agent.workspace.disallowedTools ?? [],
      model: agent.model,
    },
  }
}

/**
 * GitHub/GitLab 의 사람이 보는 주소를 raw 주소로 바꿔준다.
 * 사용자는 브라우저 주소창을 복사해 붙일 뿐 raw 링크를 찾아오지 않는다.
 */
function normalize(input: string): string {
  const url = new URL(input.trim())
  if (url.protocol !== 'https:') throw new Error('https 주소만 가져올 수 있습니다')

  if (url.hostname === 'github.com') {
    // /owner/repo/blob/ref/path → raw.githubusercontent.com/owner/repo/ref/path
    const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/)
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`
  }
  if (url.pathname.includes('/-/blob/')) {
    return url.toString().replace('/-/blob/', '/-/raw/')
  }
  return url.toString()
}

/**
 * 연결된 원본을 확인한다. **확인만 하고 아무것도 바꾸지 않는다.**
 * 반영은 사용자가 diff 를 보고 승인해야 일어난다(`applyUpdate`).
 */
export async function checkUpdate(name: string): Promise<UpdateCheck> {
  const current = library.read(name)
  const src = current?.workspace.source
  if (!current || !src) return { name, changed: false, error: '연결된 원본이 없습니다' }

  try {
    const fetched = await fetchFromUrl(src.url)
    // 확인 시각은 결과와 무관하게 남긴다 — 언제 봤는지가 정보다
    library.save({
      ...current,
      workspace: { ...current.workspace, source: { ...src, checkedAt: Date.now() } },
    })
    return {
      name,
      changed: fetched.hash !== src.hash,
      fetched,
      current: current.instructions,
    }
  } catch (e) {
    return { name, changed: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 업데이트 반영.
 *
 * 지침·설명은 원본을 따르지만 **권한과 적용 대상은 로컬 값을 유지한다.**
 * 원본이 도구를 더 요구하도록 바뀌었다고 해서 자동으로 켜주면,
 * 가져올 때 권한을 다시 정하게 한 의미가 없어진다.
 */
export async function applyUpdate(
  name: string,
  opts: { tools?: string[]; model?: string | null },
): Promise<AgentDef | undefined> {
  const current = library.read(name)
  const src = current?.workspace.source
  if (!current || !src) return undefined

  const fetched = await fetchFromUrl(src.url)
  const next: AgentDef = {
    ...current,
    description: fetched.agent.description,
    instructions: fetched.agent.instructions,
    model: opts.model === null ? undefined : (opts.model ?? current.model),
    workspace: {
      ...current.workspace,
      // 명시적으로 넘어온 경우에만 권한을 바꾼다
      allowedTools: opts.tools ? (opts.tools.length ? opts.tools : undefined) : current.workspace.allowedTools,
      source: { url: src.url, hash: fetched.hash, checkedAt: Date.now() },
    },
  }
  library.save(next)
  return next
}
