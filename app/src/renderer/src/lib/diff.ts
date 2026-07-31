/**
 * 통합 diff 생성.
 *
 * 지침 두 판을 비교해 사용자에게 보여주기 위한 것이라, 정확한 최소 편집보다
 * "읽을 수 있는 결과"가 중요하다. 줄 단위 LCS 면 충분하다.
 */

/** 줄 단위 LCS 길이 표 — 지침은 길어야 수백 줄이라 O(nm) 로 충분하다 */
function lcs(a: string[], b: string[]): number[][] {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
    }
  }
  return t
}

type Op = { kind: ' ' | '-' | '+'; text: string }

function ops(a: string[], b: string[]): Op[] {
  const t = lcs(a, b)
  const out: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: ' ', text: a[i] })
      i++
      j++
    } else if (t[i + 1][j] >= t[i][j + 1]) {
      out.push({ kind: '-', text: a[i++] })
    } else {
      out.push({ kind: '+', text: b[j++] })
    }
  }
  while (i < a.length) out.push({ kind: '-', text: a[i++] })
  while (j < b.length) out.push({ kind: '+', text: b[j++] })
  return out
}

/**
 * 바뀐 곳 주변 context 줄만 남긴 통합 diff 문자열.
 * 변경이 없으면 빈 문자열을 돌려준다.
 */
export function unifiedDiff(oldText: string, newText: string, context = 3): string {
  if (oldText === newText) return ''
  const list = ops(oldText.split('\n'), newText.split('\n'))

  // 변경 줄에서 context 안에 드는 줄만 남긴다
  const keep = new Array<boolean>(list.length).fill(false)
  list.forEach((op, idx) => {
    if (op.kind === ' ') return
    for (let k = Math.max(0, idx - context); k <= Math.min(list.length - 1, idx + context); k++) {
      keep[k] = true
    }
  })

  const lines: string[] = []
  let skipped = false
  list.forEach((op, idx) => {
    if (!keep[idx]) {
      skipped = true
      return
    }
    // 생략 구간은 한 줄로 표시해야 어디가 잘렸는지 알 수 있다
    if (skipped) {
      lines.push('@@ …')
      skipped = false
    }
    lines.push(op.kind + op.text)
  })
  return lines.join('\n')
}

/** 추가·삭제 줄 수 — 배지에 쓴다 */
export function diffStat(oldText: string, newText: string): { added: number; removed: number } {
  const list = ops(oldText.split('\n'), newText.split('\n'))
  return {
    added: list.filter((o) => o.kind === '+').length,
    removed: list.filter((o) => o.kind === '-').length,
  }
}
