import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Code from './Code'

/** 대화 본문용 마크다운. 긴 코드블록은 이미 Artifact 로 빠진 뒤라 여기엔 짧은 것만 온다. */
const components: Components = {
  h1: ({ children }) => <h1 className="mt-4 mb-2 text-base font-semibold text-text">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 mb-2 text-[15px] font-semibold text-text">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold text-text">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-medium text-subtext1">{children}</h4>,

  p: ({ children }) => <p className="my-2 leading-relaxed text-text">{children}</p>,

  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-overlay1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-overlay1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed text-text">{children}</li>,

  strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
  em: ({ children }) => <em className="italic text-subtext1">{children}</em>,
  del: ({ children }) => <del className="text-overlay1">{children}</del>,

  a: ({ children, href }) => (
    <a href={href} className="text-blue underline decoration-blue/40 hover:decoration-blue">
      {children}
    </a>
  ),

  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-surface2 pl-3 text-subtext1">{children}</blockquote>
  ),

  hr: () => <hr className="my-4 border-surface0" />,

  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-surface1 px-2.5 py-1.5 text-left font-medium text-subtext1">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-surface0/60 px-2.5 py-1.5 align-top text-text">{children}</td>
  ),

  code: ({ className, children, ...props }) => {
    const text = String(children ?? '').replace(/\n$/, '')
    const lang = /language-(\w[\w+-]*)/.exec(className ?? '')?.[1]
    const isBlock = text.includes('\n') || Boolean(lang)

    if (!isBlock) {
      return (
        <code
          className="rounded bg-surface0 px-1 py-0.5 font-mono text-[1em] text-peach"
          {...props}
        >
          {children}
        </code>
      )
    }
    return <Code code={text} language={lang} className="my-2" />
  },

  // code 컴포넌트에서 이미 <pre> 를 만들어 주므로 감싸지 않는다
  pre: ({ children }) => <>{children}</>,
}

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
