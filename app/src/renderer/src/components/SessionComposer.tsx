import { forwardRef } from 'react'
import { CircleStop, ImagePlus, Monitor, PencilLine, Terminal, X } from 'lucide-react'
import type { DetectedRunner } from '@shared/session'
import { runnerEnvironmentLabel } from '@shared/runner'
import PromptInput, { type PromptInputHandle } from './PromptInput'

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
  runners: DetectedRunner[]
  showRunnerPicker: boolean
  onAnnotate: (index: number) => void
  onAttachFiles: (files: FileList) => void | Promise<void>
  onChooseRunner: (runnerId: string) => void | Promise<void>
  onRemoveAttachment: (index: number) => void
  onStop: (sessionId: string) => void | Promise<void>
  onSubmit: (text: string) => void
}

const PROVIDER_LABEL: Record<string, string> = {
  'claude-cli': 'Claude',
  'codex-cli': 'Codex',
  'claude-agent-sdk': 'Claude (SDK)',
}
const PROVIDER_ORDER = ['claude-cli', 'codex-cli', 'claude-agent-sdk']
const runnerLabel = (runner: DetectedRunner): string =>
  runnerEnvironmentLabel(runner) + (runner.version ? ` · ${runner.version}` : '')

const SessionComposer = forwardRef<PromptInputHandle, Props>(function SessionComposer(
  props,
  ref,
) {
  const {
    active,
    activeSessionId,
    attachments,
    busy,
    runners,
    showRunnerPicker,
    onAnnotate,
    onAttachFiles,
    onChooseRunner,
    onRemoveAttachment,
    onStop,
    onSubmit,
  } = props

  return (
    <div className="col-start-2 row-start-3 bg-mantle p-2.5">
      {showRunnerPicker && <RunnerPicker runners={runners} onChoose={onChooseRunner} />}
      <AttachmentStrip
        attachments={attachments}
        onAnnotate={onAnnotate}
        onRemove={onRemoveAttachment}
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
        <PromptInput ref={ref} active={active} busy={busy} onSubmit={onSubmit} />
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

function RunnerPicker({
  runners,
  onChoose,
}: {
  runners: DetectedRunner[]
  onChoose: (runnerId: string) => void | Promise<void>
}) {
  return (
    <div className="mb-2.5 rounded-lg bg-surface0/60 p-3">
      <div className="mb-2 text-[12px] text-subtext1">
        이 프로젝트를 어디서 실행할까요?
        <span className="ml-2 text-overlay1">한 번 정하면 기억합니다</span>
      </div>
      <div className="space-y-2">
        {PROVIDER_ORDER.filter((provider) =>
          runners.some((runner) => runner.provider === provider),
        ).map((provider) => (
          <div key={provider}>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-overlay1">
              {PROVIDER_LABEL[provider]}
            </div>
            <div className="flex flex-wrap gap-2">
              {runners
                .filter((runner) => runner.provider === provider)
                .map((runner) => {
                  const Icon = runner.kind === 'wsl' ? Terminal : Monitor
                  return (
                    <button
                      key={runner.id}
                      onClick={() => void onChoose(runner.id)}
                      className="flex items-center gap-2 rounded-md bg-surface0 px-3 py-2 text-left text-[12px] hover:bg-surface1"
                    >
                      <Icon className="h-4 w-4 text-sapphire" />
                      <span>
                        <span className="block text-subtext1">{runnerLabel(runner)}</span>
                        <span className="block text-[11px] text-overlay1">
                          {runner.installMethod}
                        </span>
                      </span>
                    </button>
                  )
                })}
            </div>
          </div>
        ))}
        {runners.length === 0 && (
          <span className="text-[12px] text-yellow">실행 가능한 CLI를 찾지 못했습니다</span>
        )}
      </div>
    </div>
  )
}

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
