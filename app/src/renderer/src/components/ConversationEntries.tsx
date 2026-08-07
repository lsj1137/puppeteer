import { useEffect, useState } from 'react'
import { AlertTriangle, Check, FileCode2, Loader2, Sparkles, X } from 'lucide-react'
import type { MemoryProposal } from '@shared/session'
import type { SessionView } from '../lib/session-view'
import { artifactTitle, lineCount } from './ArtifactPanel'
import Markdown from './Markdown'
import ToolEntry from './ToolEntry'

interface Props {
  selectedArtifact?: string
  view: SessionView
  onSelectArtifact: (id: string) => void
  onOpenMemory?: () => void
}

/** 세션의 충돌 경고와 사용자·도구·assistant 메시지를 순서대로 렌더링한다. */
export default function ConversationEntries({
  selectedArtifact,
  view,
  onSelectArtifact,
  onOpenMemory,
}: Props) {
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
            <div key={entry.id} className="min-w-0 max-w-full rounded-lg bg-surface0/50 px-3.5 py-2.5">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-overlay1">
                나
              </div>
              <div className="min-w-0 max-w-full whitespace-pre-wrap break-words text-sm text-text [overflow-wrap:anywhere]">
                {entry.text}
              </div>
            </div>
          )
        }
        if (entry.kind === 'tool') return <ToolEntry key={entry.id} entry={entry} />
        if (entry.kind === 'memory-proposal') {
          return (
            <MemoryProposalCard
              key={entry.id}
              proposal={entry.proposal}
              onOpenMemory={onOpenMemory}
            />
          )
        }
        if (entry.kind === 'notice') {
          if (entry.title === '자동 커밋·병합 완료') {
            return null
          }
          if (entry.title === '승인 요청 시간 초과') {
            return (
              <div key={entry.id} className="flex w-fit items-center gap-1.5 rounded-md bg-yellow/10 px-2 py-1 text-[12px] text-yellow">
                <AlertTriangle className="h-3 w-3 shrink-0 text-yellow" />
                <span>승인 요청 시간 초과</span>
              </div>
            )
          }
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
          <div key={entry.id} className="min-w-0 max-w-full px-0.5">
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

function MemoryProposalCard({
  proposal,
  onOpenMemory,
}: {
  proposal: MemoryProposal
  onOpenMemory?: () => void
}) {
  const [state, setState] = useState<'checking' | 'pending' | 'approved' | 'rejected' | 'error'>(
    'checking',
  )

  useEffect(() => {
    void window.api.memoryProposals().then((items) =>
      setState(items.some(({ id }) => id === proposal.id) ? 'pending' : 'approved'),
    )
  }, [proposal.id])

  async function decide(approve: boolean): Promise<void> {
    setState('checking')
    if (approve) {
      const ok = await window.api.approveMemoryProposal(proposal.id)
      setState(ok ? 'approved' : 'error')
    } else {
      await window.api.rejectMemoryProposal(proposal.id)
      setState('rejected')
    }
  }

  if (state === 'approved' || state === 'rejected') return null

  return (
    <div className="rounded-lg border border-mauve/40 bg-mauve/10 p-3 text-[12px]">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-mauve" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-text">Memory에 추가할까요?</div>
          <div className="mt-0.5 text-subtext0">{proposal.reason}</div>
          <div className="mt-2 whitespace-pre-wrap rounded-md bg-base px-2.5 py-2 font-mono text-[11px] leading-relaxed text-subtext1">
            {proposal.content}
          </div>
          <div className="mt-1.5 text-[10px] text-overlay1">
            {proposal.scope === 'project' ? 'Project Memory' : 'Agent Memory'} · 승인 전에는 정본 파일을 변경하지 않습니다.
          </div>
          {state === 'error' && (
            <div className="mt-1.5 text-[11px] text-red">적용하지 못했습니다. Memory 화면에서 정본과 파일 권한을 확인하세요.</div>
          )}
        </div>
      </div>
      <div className="mt-2 flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onOpenMemory}
          className="rounded-md px-2.5 py-1.5 text-[11px] text-subtext1 hover:bg-surface0 hover:text-text"
        >
          Memory에서 검토
        </button>
        <button
          type="button"
          disabled={state === 'checking'}
          onClick={() => void decide(false)}
          className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] text-overlay1 hover:bg-red/10 hover:text-red disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" /> 거절
        </button>
        <button
          type="button"
          disabled={state === 'checking'}
          onClick={() => void decide(true)}
          className="flex items-center gap-1 rounded-md bg-green/15 px-2.5 py-1.5 text-[11px] font-medium text-green hover:bg-green/25 disabled:opacity-40"
        >
          {state === 'checking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          승인해 추가
        </button>
      </div>
    </div>
  )
}

