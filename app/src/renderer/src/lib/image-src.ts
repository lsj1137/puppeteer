/** 대화 이미지 주소의 종류. 외부 주소는 눌러야 불러온다 — 앱이 몰래 외부로 요청을 보내지 않게. */
export type ImageSource =
  | { kind: 'remote'; url: string; host: string }
  | { kind: 'inline'; url: string }
  | { kind: 'local'; url: string; path: string }
  | { kind: 'invalid' }

/** 로컬 이미지를 앱 전용 통로(`pp-image://`)로 바꾼다. 상대 경로는 작업 폴더(base) 기준이다. */
export function classifyImage(src: string | undefined, base?: string): ImageSource {
  const raw = src?.trim()
  if (!raw) return { kind: 'invalid' }
  if (/^https?:\/\//i.test(raw)) {
    try {
      return { kind: 'remote', url: raw, host: new URL(raw).host }
    } catch {
      return { kind: 'invalid' }
    }
  }
  // Markdown 파서는 이미지 주소의 백슬래시·공백을 퍼센트 인코딩해 넘긴다
  // (`C:\Users\x y\p.png` → `C:%5CUsers%5Cx%20y%5Cp.png`). 풀지 않으면 Windows 경로로 못 알아본다.
  const s = safeDecode(raw)
  if (/^(data:image\/|blob:)/i.test(s)) return { kind: 'inline', url: s }
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^file:/i.test(s) && !/^[A-Za-z]:[\\/]/.test(s)) {
    // javascript: 등 다른 스킴은 그리지 않는다.
    return { kind: 'invalid' }
  }
  const params = new URLSearchParams({ path: s })
  if (base) params.set('base', base)
  return { kind: 'local', url: `pp-image://local/?${params.toString()}`, path: s }
}

function safeDecode(value: string): string {
  if (/^data:/i.test(value)) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
