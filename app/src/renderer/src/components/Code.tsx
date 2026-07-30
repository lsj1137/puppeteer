import { useEffect, useState } from 'react'
import { highlight, normalizeLang } from '../lib/highlight'
import { shikiTheme, useTheme } from '../lib/theme'

interface Props {
  code: string
  language?: string
  lineNumbers?: boolean
  className?: string
}

/**
 * shiki 로 하이라이팅한 코드 블록.
 * 하이라이팅 전/실패 시에도 코드 자체는 항상 보이고, 실패는 조용히 넘기지 않고 표시한다.
 */
export default function Code({ code, language, lineNumbers, className }: Props) {
  const [html, setHtml] = useState<string>()
  const [failed, setFailed] = useState<string>()
  const theme = useTheme()

  useEffect(() => {
    let alive = true
    setFailed(undefined)
    highlight(code, language, { lineNumbers, theme: shikiTheme(theme) })
      .then((h) => {
        if (alive) setHtml(h)
      })
      .catch((e: unknown) => {
        if (alive) setFailed(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [code, language, lineNumbers, theme])

  if (html && !failed) {
    return (
      <div
        className={`shiki-wrap overflow-x-auto rounded-md ${lineNumbers ? 'shiki-lines' : ''} ${
          className ?? ''
        }`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <div className={className}>
      {failed && (
        <div className="mb-1 rounded bg-red/10 px-2 py-1 text-[11px] text-red">
          문법 강조 실패 ({normalizeLang(language)}) · {failed.slice(0, 120)}
        </div>
      )}
      <pre className="overflow-x-auto rounded-md bg-crust p-2.5 font-mono text-[13px] leading-relaxed text-subtext1">
        {code}
      </pre>
    </div>
  )
}
