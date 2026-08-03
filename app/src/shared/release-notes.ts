/** GitHub Release가 돌려주는 HTML을 설정 화면용 안전한 평문으로 바꾼다. */
export function releaseNotesToText(value: string): string {
  if (!/<[a-z][\s\S]*>/i.test(value)) return value.trim()

  return decodeEntities(
    value
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*li\b[^>]*>/gi, '- ')
      .replace(/<\s*\/\s*(?:li|p|h[1-6])\s*>/gi, '\n')
      .replace(/<\s*\/?\s*(?:ul|ol)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  )
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const hex = body[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity
    }
    return named[body.toLowerCase()] ?? entity
  })
}
