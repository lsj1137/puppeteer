import { AlertTriangle, FileCode2 } from 'lucide-react'
import type { SessionView } from '../lib/session-view'
import { artifactTitle, lineCount } from './ArtifactPanel'
import Markdown from './Markdown'
import ToolEntry from './ToolEntry'

interface Props {
  selectedArtifact?: string
  view: SessionView
  onSelectArtifact: (id: string) => void
}

/** 세션의 충돌 경고와 사용자·도구·assistant 메시지를 순서대로 렌더링한다. */
export default function ConversationEntries({ selectedArtifact, view, onSelectArtifact }: Props) {
  return (
    <>
      {view.conflicts.map((conflict) => (
        <div
          key={conflict.path}
          className="flex gap-2 rounded-lg border border-yellow/50 bg-yellow/10 p-3 text-[12px]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow" />
          <div>
            <div className="font-semibold text-text">동시 수정 감지</div>
            <div className="mt-0.5 text-subtext1">
              <span className="font-mono">{conflict.path}</span> 를 다른 세션(
              <span className="text-subtext0">{conflict.otherTitle}</span>)도 수정했습니다. 한쪽을
              중지하거나 결과를 확인하세요.
            </div>
          </div>
        </div>
      ))}

      {view.entries.map((entry) => {
        if (entry.kind === 'user') {
          return (
            <div key={entry.id} className="rounded-lg bg-surface0/50 px-3.5 py-2.5">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-overlay1">
                나
              </div>
              <div className="whitespace-pre-wrap text-sm text-text">{entry.text}</div>
            </div>
          )
        }
        if (entry.kind === 'tool') return <ToolEntry key={entry.id} entry={entry} />
        if (entry.kind === 'notice') {
          return (
            <div
              key={entry.id}
              className={`flex gap-2 rounded-lg border p-3 text-[12px] ${
                entry.level === 'error'
                  ? 'border-red/50 bg-red/5 text-red'
                  : entry.level === 'warning'
                    ? 'border-yellow/50 bg-yellow/10 text-yellow'
                    : 'border-sapphire/40 bg-sapphire/10 text-sapphire'
              }`}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-text">{entry.title}</div>
                <div className="mt-0.5 whitespace-pre-wrap text-subtext1">{entry.text}</div>
              </div>
            </div>
          )
        }
        if (entry.isError) {
          return (
            <div
              key={entry.id}
              className="flex gap-2 rounded-lg border border-red/50 bg-red/5 p-3 text-[12px] text-red"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">API 오류</div>
                <div className="mt-0.5 whitespace-pre-wrap text-red/90">{view.statusReason}</div>
                <div className="mt-1.5 text-[11px] text-overlay1">
                  서버 측 일시 오류입니다. 잠시 후 같은 지시를 다시 보내면 됩니다.
                </div>
              </div>
            </div>
          )
        }
        return (
          <div key={entry.id} className="px-0.5">
            {entry.segments.map((segment, index) => {
              if (segment.type === 'md') return <Markdown key={index}>{segment.text}</Markdown>
              const artifact = view.artifacts.find(({ id }) => id === segment.artifactId)
              if (!artifact) return null
              return (
                <button
                  key={index}
                  onClick={() => onSelectArtifact(artifact.id)}
                  className={`my-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[12px] ${
                    selectedArtifact === artifact.id
                      ? 'bg-sapphire/20'
                      : 'bg-surface0/60 hover:bg-surface0'
                  }`}
                >
                  <FileCode2 className="h-4 w-4 shrink-0 text-sapphire" />
                  <span className="flex-1 truncate text-subtext1">{artifactTitle(artifact)}</span>
                  <span className="shrink-0 font-mono text-[11px] text-overlay1">
                    {lineCount(artifact.content)}L
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </>
  )
}
