import { createContext, useContext, useEffect, useId, useState } from 'react'
import DOMPurify from 'dompurify'
import { ImageOff, ImageIcon } from 'lucide-react'
import { classifyImage } from '../lib/image-src'
import { useTheme } from '../lib/theme'
import Code from './Code'

/** 대화 이미지의 상대 경로를 풀 작업 폴더(worktree 또는 프로젝트) */
export const MarkdownBaseContext = createContext<string | undefined>(undefined)

/** `![설명](경로)` — 로컬은 앱 전용 통로로, 외부 주소는 눌러야 불러온다. */
export function ChatImage({ src, alt }: { src?: string; alt?: string }) {
  const base = useContext(MarkdownBaseContext)
  const source = classifyImage(src, base)
  const [allowed, setAllowed] = useState(false)
  const [failed, setFailed] = useState(false)

  if (source.kind === 'invalid') return null
  if (source.kind === 'remote' && !allowed) {
    return (
      <button
        type="button"
        onClick={() => setAllowed(true)}
        title={source.url}
        className="my-2 flex max-w-full items-center gap-2 rounded-lg border border-surface1 bg-surface0/50 px-3 py-2 text-left text-[12px] text-subtext1 hover:bg-surface0"
      >
        <ImageIcon className="h-4 w-4 shrink-0 text-overlay1" />
        <span className="min-w-0">
          <span className="block font-medium text-text">외부 이미지 불러오기</span>
          <span className="block truncate text-overlay1">{alt ? `${alt} · ` : ''}{source.host}</span>
        </span>
      </button>
    )
  }
  if (failed) {
    return (
      <span className="my-2 flex items-center gap-1.5 text-[12px] text-overlay1">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        이미지를 불러오지 못했습니다{source.kind === 'local' ? ` — ${source.path}` : ''}
      </span>
    )
  }
  return (
    <img
      src={source.url}
      alt={alt ?? ''}
      title={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="my-2 max-h-[480px] max-w-full rounded-lg border border-surface0 object-contain"
    />
  )
}

/**
 * ```mermaid 블록을 그림으로. 라이브러리가 커서 이 블록이 처음 나올 때만 불러온다.
 * 응답이 스트리밍 중이면 문법이 덜 끝나 실패하므로, 그동안은 코드로 보여주고 다 그려지면 바꾼다.
 */
export function MermaidBlock({ code }: { code: string }) {
  const theme = useTheme()
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [svg, setSvg] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let alive = true
    const timer = setTimeout(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        // 보안 수준 strict — 다이어그램 안 링크·스크립트·HTML 라벨을 막는다.
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'light' ? 'default' : 'dark' })
        const { svg } = await mermaid.render(id, code)
        if (alive) {
          setSvg(svg)
          setError(undefined)
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
        // mermaid 는 실패해도 오류 그림을 body 에 남긴다.
        document.getElementById(`d${id}`)?.remove()
      }
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [code, id, theme])

  if (svg) {
    return (
      <div
        className="my-2 overflow-x-auto rounded-lg border border-surface0 bg-base/40 p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }
  return (
    <div className="my-2">
      <Code code={code} language="mermaid" />
      {error && <div className="mt-1 text-[11px] text-overlay1">다이어그램으로 그리지 못했습니다: {error.split('\n')[0]}</div>}
    </div>
  )
}

/** ```svg 블록을 그림으로. 스크립트·이벤트 속성·외부 참조는 걸러낸다. */
export function SvgBlock({ code }: { code: string }) {
  const clean = DOMPurify.sanitize(code, { USE_PROFILES: { svg: true, svgFilters: true } })
  if (!/<svg[\s>]/i.test(clean)) return <Code code={code} language="svg" className="my-2" />
  return (
    <div
      className="my-2 overflow-x-auto rounded-lg border border-surface0 bg-base/40 p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
