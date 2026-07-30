/**
 * assistant 메시지에서 코드펜스를 분리한다.
 * 모델이 대화 본문에 코드를 출력하는 것 자체는 막을 수 없으므로,
 * 긴 블록만 Artifact 로 빼고 짧은 블록·인라인 코드는 대화에 남긴다. (기획서 9장)
 */

export interface UiArtifact {
  id: string
  kind: 'code' | 'log' | 'diff' | 'md'
  language?: string
  path?: string
  content: string
}

export type Segment =
  | { type: 'md'; text: string }
  | { type: 'artifact'; artifactId: string }

/** 이 줄 수 이하의 코드블록은 대화에 그대로 둔다 */
export const INLINE_MAX_LINES = 5

/** ```ts:src/a.ts → { language:'ts', path:'src/a.ts' } */
function parseInfo(info: string): { language?: string; path?: string } {
  const s = info.trim()
  if (!s) return {}
  const [lang, ...rest] = s.split(':')
  const path = rest.join(':').trim()
  return { language: lang.trim() || undefined, path: path || undefined }
}

export function splitFences(
  text: string,
  keyPrefix: string,
): { segments: Segment[]; artifacts: UiArtifact[] } {
  const lines = text.split('\n')
  const segments: Segment[] = []
  const artifacts: UiArtifact[] = []

  let buf: string[] = []
  let fence: { info: string; body: string[]; marker: string } | undefined
  let n = 0

  const flushMd = (): void => {
    if (buf.length && buf.join('').trim()) segments.push({ type: 'md', text: buf.join('\n') })
    buf = []
  }

  for (const line of lines) {
    const open = line.match(/^\s*(`{3,}|~{3,})(.*)$/)

    if (!fence && open) {
      flushMd()
      fence = { info: open[2] ?? '', body: [], marker: open[1] }
      continue
    }

    if (fence) {
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/)
      if (close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length) {
        const body = fence.body.join('\n')
        const { language, path } = parseInfo(fence.info)

        if (fence.body.length > INLINE_MAX_LINES) {
          const id = `${keyPrefix}-a${n++}`
          artifacts.push({
            id,
            kind:
              language === 'diff'
                ? 'diff'
                : language === 'md' || language === 'markdown'
                  ? 'md'
                  : 'code',
            language,
            path,
            content: body,
          })
          segments.push({ type: 'artifact', artifactId: id })
        } else {
          // 짧은 블록은 마크다운 그대로 둔다
          buf.push(`${fence.marker}${fence.info}`, ...fence.body, fence.marker)
        }
        fence = undefined
        continue
      }
      fence.body.push(line)
      continue
    }

    buf.push(line)
  }

  // 닫히지 않은 펜스 — 있는 그대로 살린다
  if (fence) buf.push(`${fence.marker}${fence.info}`, ...fence.body)
  flushMd()

  return { segments, artifacts }
}
