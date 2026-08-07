import { forwardRef, useEffect, useState } from 'react'
import { CircleStop, ImagePlus, PencilLine, X } from 'lucide-react'
import type { DetectedRunner } from '@shared/session'
import PromptInput, { type PromptInputHandle } from './PromptInput'
import { ComposerSettings } from './SessionHeader'
import type { AgentDef } from '@shared/session'

interface Attachment {
  path: string
  url: string
  name: string
}

interface Props {
  active: boolean
  activeSessionId?: string
  attachments: Attachment[]
  busy: boolean
  historyKey: string
  promptHistory: string[]
  runningSessionIds: string[]
  runners: DetectedRunner[]
  showRunnerPicker: boolean
  activeRunner?: DetectedRunner
  runnerLocked: boolean
  agentName?: string
  agents: AgentDef[]
  agentMenuOpen: boolean
  commitNotice?: { id: string; title: string; text: string; status: 'success' | 'warning' }
  onAnnotate: (index: number) => void
  onAttachFiles: (files: FileList) => void | Promise<void>
  onChooseRunner: (runnerId: string) => void | Promise<void>
  onToggleAgentMenu: () => void
  onCloseAgentMenu: () => void
  onSelectAgent: (name?: string) => void
  onEditAgent: (agent: AgentDef) => void
  onNewAgent: () => void
  onRemoveAttachment: (index: number) => void
  onStop: (sessionId: string) => void | Promise<void>
  onSubmit: (text: string) => void
  onSubmitToSession: (text: string, sessionId: string) => void | Promise<void>
}

const SessionComposer = forwardRef<PromptInputHandle, Props>(function SessionComposer(
  props,
  ref,
) {
  const {
    active,
    activeSessionId,
    attachments,
    busy,
    historyKey,
    promptHistory,
    runningSessionIds,
    runners,
    showRunnerPicker,
    activeRunner,
    runnerLocked,
    agentName,
    agents,
    agentMenuOpen,
    commitNotice,
    onAnnotate,
    onAttachFiles,
    onChooseRunner,
    onToggleAgentMenu,
    onCloseAgentMenu,
    onSelectAgent,
    onEditAgent,
    onNewAgent,
    onRemoveAttachment,
    onStop,
    onSubmit,
    onSubmitToSession,
  } = props
  const [queuedPrompt, setQueuedPrompt] = useState<{ text: string; sessionId: string }>()

  useEffect(() => {
    if (!queuedPrompt || runningSessionIds.includes(queuedPrompt.sessionId)) return
    const queued = queuedPrompt
    setQueuedPrompt(undefined)
    void onSubmitToSession(queued.text, queued.sessionId)
  }, [onSubmitToSession, queuedPrompt, runningSessionIds])

  return (
    <div className="col-start-2 row-start-3 min-w-0 overflow-visible bg-mantle p-2.5">
      <AttachmentStrip
        attachments={attachments}
        onAnnotate={onAnnotate}
        onRemove={onRemoveAttachment}
      />
      {queuedPrompt && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-sapphire/25 bg-sapphire/5 px-2.5 py-1.5 text-[11px]">
          <span className="shrink-0 font-medium text-sapphire">다음 지시</span>
          <span className="min-w-0 flex-1 truncate text-subtext1">{queuedPrompt.text}</span>
          <button
            type="button"
            onClick={() => setQueuedPrompt(undefined)}
            title="예약 취소"
            className="shrink-0 rounded p-0.5 text-overlay1 hover:bg-surface0 hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <ComposerSettings
        activeRunner={activeRunner}
        runnerLocked={runnerLocked}
        runners={runners}
        commitNotice={commitNotice}
        onChooseRunner={(runnerId) => {
          void Promise.resolve(onChooseRunner(runnerId)).finally(onCloseAgentMenu)
        }}
        agentName={agentName}
        agents={agents}
        open={agentMenuOpen || showRunnerPicker}
        onToggle={onToggleAgentMenu}
        onClose={onCloseAgentMenu}
        onSelect={onSelectAgent}
        onEdit={onEditAgent}
        onNew={onNewAgent}
      />
      <div className="flex items-end gap-2">
        <label
          title="이미지 첨부"
          className="flex h-[42px] w-[42px] shrink-0 cursor-pointer items-center justify-center rounded-lg bg-surface0/60 text-subtext0 hover:bg-surface0 hover:text-text"
        >
          <ImagePlus className="h-4 w-4" />
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void onAttachFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </label>
        <PromptInput
          ref={ref}
          active={active}
          busy={busy}
          historyKey={historyKey}
          initialHistory={promptHistory}
          queued={Boolean(queuedPrompt)}
          onQueue={(text) => {
            if (activeSessionId) setQueuedPrompt({ text, sessionId: activeSessionId })
          }}
          onSubmit={onSubmit}
        />
        {busy && activeSessionId && (
          <button
            onClick={() => void onStop(activeSessionId)}
            title="중지"
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-red/15 text-red hover:bg-red/25"
          >
            <CircleStop className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
})

function AttachmentStrip({
  attachments,
  onAnnotate,
  onRemove,
}: {
  attachments: Attachment[]
  onAnnotate: (index: number) => void
  onRemove: (index: number) => void
}) {
  if (attachments.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment, index) => (
        <div
          key={attachment.path}
          className="group relative h-16 w-16 overflow-hidden rounded-md"
          title={attachment.name}
        >
          <img src={attachment.url} alt={attachment.name} className="h-full w-full object-cover" />
          <button
            onClick={() => onAnnotate(index)}
            className="absolute bottom-0.5 left-0.5 hidden rounded bg-crust/80 p-0.5 text-lavender group-hover:block"
            title="주석 달기"
          >
            <PencilLine className="h-3 w-3" />
          </button>
          <button
            onClick={() => onRemove(index)}
            className="absolute right-0.5 top-0.5 hidden rounded bg-crust/80 p-0.5 text-red group-hover:block"
            title="첨부 제거"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

export default SessionComposer
