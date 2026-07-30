import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  FileCode2,
  FileDiff,
  FileText,
  PanelRightClose,
  ScrollText,
} from 'lucide-react'
import Markdown from './Markdown'
import type { UiArtifact } from '../lib/fences'
import Code from './Code'

const ICON = {
  code: FileCode2,
  diff: FileDiff,
  log: ScrollText,
  md: FileText,
} as const

const TINT: Record<string, string> = {
  code: 'text-sapphire',
  diff: 'text-peach',
  log: 'text-teal',
  md: 'text-lavender',
}

export const artifactTitle = (a: UiArtifact): string =>
  a.path ?? (a.kind === 'log' ? '실행 결과' : (a.language ?? a.kind))

export const lineCount = (s: string): number => s.split('\n').length

export default function ArtifactPanel({
  artifacts,
  selectedId,
  onSelect,
  onCollapse,
}: {
  artifacts: UiArtifact[]
  selectedId?: string
  onSelect: (id: string) => void
  onCollapse: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [raw, setRaw] = useState(false)
  const selected = artifacts.find((a) => a.id === selectedId) ?? artifacts[artifacts.length - 1]

  useEffect(() => {
    setCopied(false)
    setRaw(false)
  }, [selected?.id])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-surface0 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-overlay1">
        <span className="flex-1">
          Artifacts
          {artifacts.length > 0 && <span className="ml-1.5 text-subtext0">{artifacts.length}</span>}
        </span>
        <button
          onClick={onCollapse}
          title="패널 접기"
          className="rounded p-0.5 text-overlay1 hover:bg-surface0 hover:text-text"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {artifacts.length === 0 && (
        <div className="p-3 text-[12px] text-overlay1">
          코드·실행 결과가 생기면 여기에 모입니다
        </div>
      )}

      {artifacts.length > 0 && (
        <>
          <div className="max-h-40 shrink-0 overflow-auto border-b border-surface0 p-1.5">
            {artifacts.map((a) => {
              const Icon = ICON[a.kind]
              const on = a.id === selected?.id
              return (
                <button
                  key={a.id}
                  onClick={() => onSelect(a.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] ${
                    on ? 'bg-surface0 text-text' : 'text-subtext1 hover:bg-surface0/50'
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${TINT[a.kind] ?? 'text-sapphire'}`} />
                  <span className="flex-1 truncate">{artifactTitle(a)}</span>
                  <span className="shrink-0 font-mono text-[11px] text-overlay1">
                    {lineCount(a.content)}L
                  </span>
                </button>
              )
            })}
          </div>

          {selected && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-surface0 bg-surface0/40 px-3 py-1.5">
                <span className="flex-1 truncate font-mono text-[12px] text-subtext1">
                  {artifactTitle(selected)}
                </span>
                <span className="shrink-0 rounded bg-surface1 px-1.5 py-0.5 text-[11px] text-subtext0">
                  {selected.kind === 'md'
                    ? 'markdown'
                    : selected.kind === 'log'
                      ? 'log'
                      : (selected.language ?? selected.kind)}
                </span>
                {selected.kind === 'md' && (
                  <button
                    onClick={() => setRaw((v) => !v)}
                    title={raw ? '렌더링 보기' : '원문 보기'}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-overlay1 hover:bg-surface0 hover:text-text"
                  >
                    {raw ? '렌더' : '원문'}
                  </button>
                )}
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(selected.content)
                    setCopied(true)
                  }}
                  title="복사"
                  className="rounded p-1 text-overlay1 hover:bg-surface0 hover:text-text"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-2">
                {selected.kind === 'md' && !raw ? (
                  <div className="px-1">
                    <Markdown>{selected.content}</Markdown>
                  </div>
                ) : (
                  <Code
                    code={selected.content}
                    language={
                      selected.kind === 'log'
                        ? 'log'
                        : selected.kind === 'diff'
                          ? 'diff'
                          : selected.kind === 'md'
                            ? 'markdown'
                            : (selected.language ?? 'plaintext')
                    }
                    lineNumbers={selected.kind !== 'log'}
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
