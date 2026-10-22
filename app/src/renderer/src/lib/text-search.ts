/**
 * 대화·지시 검색의 순수 로직. 대소문자를 가리지 않고, 겹치지 않게 찾는다.
 *
 * 소문자로 바꾸면 길이가 달라지는 글자(`İ` 등)가 섞이면 위치가 어긋난다. 그때는 대소문자를
 * 가려서 찾는다 — 엉뚱한 곳을 칠하는 것보다 덜 찾는 편이 낫다.
 */
export function matchOffsets(text: string, query: string): number[] {
  const q = query.trim()
  if (!q || !text) return []
  const folded = text.toLowerCase()
  const foldedQuery = q.toLowerCase()
  const sameLength = folded.length === text.length && foldedQuery.length === q.length
  const haystack = sameLength ? folded : text
  const needle = sameLength ? foldedQuery : q

  const offsets: number[] = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    offsets.push(at)
    from = at + needle.length
  }
  return offsets
}

/** 강조 표시용으로 글을 일치/불일치 조각으로 나눈다. */
export function highlightParts(text: string, query: string): Array<{ text: string; match: boolean }> {
  const offsets = matchOffsets(text, query)
  if (offsets.length === 0) return [{ text, match: false }]
  const length = query.trim().length
  const parts: Array<{ text: string; match: boolean }> = []
  let cursor = 0
  for (const at of offsets) {
    if (at > cursor) parts.push({ text: text.slice(cursor, at), match: false })
    parts.push({ text: text.slice(at, at + length), match: true })
    cursor = at + length
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false })
  return parts
}

/** 지시 목록을 거른다. 번호는 걸러도 원래 순번을 유지한다(«몇 번째 지시였나» 가 기준이다). */
export function filterNumbered<T extends { text: string }>(
  items: T[],
  query: string,
): Array<{ item: T; number: number }> {
  const numbered = items.map((item, i) => ({ item, number: i + 1 }))
  if (!query.trim()) return numbered
  return numbered.filter(({ item }) => matchOffsets(item.text, query).length > 0)
}
