import { createHighlighter, type Highlighter } from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

/** 앱에서 쓸 언어만 싣는다. 전체 번들은 수 MB라 과하다. */
const LANGS = [
  'typescript', 'javascript', 'tsx', 'jsx', 'json', 'bash', 'shell',
  'python', 'java', 'sql', 'html', 'css', 'markdown', 'yaml', 'xml',
  'diff', 'ini', 'dockerfile',
]

const ALIAS: Record<string, string> = {
  ts: 'typescript', js: 'javascript', sh: 'bash', zsh: 'bash', py: 'python',
  yml: 'yaml', md: 'markdown', htm: 'html', console: 'bash', text: 'plaintext',
  txt: 'plaintext', log: 'plaintext',
}

let hlPromise: Promise<Highlighter> | undefined

function get(): Promise<Highlighter> {
  // 기본 oniguruma 엔진은 WebAssembly 를 쓰는데, 렌더러 CSP(script-src 'self')가 이를 막는다.
  // CSP 를 푸는 대신 JS 정규식 엔진을 쓴다 — 모델 출력을 DOM 에 넣는 앱이라 script-src 는 조인다.
  hlPromise ??= createHighlighter({
    themes: ['catppuccin-mocha', 'catppuccin-latte'],
    langs: LANGS,
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  })
  return hlPromise
}

export function normalizeLang(lang?: string): string {
  const l = (lang ?? '').toLowerCase()
  const mapped = ALIAS[l] ?? l
  return LANGS.includes(mapped) ? mapped : 'plaintext'
}

export async function highlight(
  code: string,
  lang?: string,
  opts?: { lineNumbers?: boolean; theme?: string },
): Promise<string> {
  const hl = await get()
  const language = normalizeLang(lang)
  const srcLines = code.split('\n')
  const transformers: Parameters<typeof hl.codeToHtml>[1]['transformers'] = []

  if (opts?.lineNumbers) {
    transformers.push({
      line(node, line) {
        node.properties['data-line'] = String(line)
      },
    })
  }

  // diff 는 줄 배경을 인라인 스타일로 직접 박는다.
  // 클래스 + 외부 CSS 로 하면 shiki 인라인 스타일·캐스케이드에 묻힐 수 있어 확실한 쪽을 택했다.
  if (language === 'diff') {
    const dark = (opts?.theme ?? '').includes('mocha')
    const style = {
      add: dark
        ? 'background:rgba(166,227,161,.22);box-shadow:inset 3px 0 0 #a6e3a1'
        : 'background:rgba(53,135,31,.18);box-shadow:inset 3px 0 0 #35871f',
      del: dark
        ? 'background:rgba(243,139,168,.22);box-shadow:inset 3px 0 0 #f38ba8'
        : 'background:rgba(192,12,51,.16);box-shadow:inset 3px 0 0 #c00c33',
      hunk: dark ? 'background:rgba(116,199,236,.14)' : 'background:rgba(23,121,140,.12)',
      file: 'opacity:.7',
    }
    transformers.push({
      line(node, line) {
        const t = srcLines[line - 1] ?? ''
        const s =
          t.startsWith('+++') || t.startsWith('---')
            ? style.file
            : t.startsWith('@@')
              ? style.hunk
              : t.startsWith('+')
                ? style.add
                : t.startsWith('-')
                  ? style.del
                  : ''
        if (!s) return
        node.properties['style'] = s
      },
    })
  }

  return hl.codeToHtml(code, {
    lang: language,
    theme: opts?.theme ?? 'catppuccin-mocha',
    transformers,
  })
}
