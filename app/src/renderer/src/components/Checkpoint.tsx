import { useState } from 'react'
import { Bot, Copy, Check, Flag, X } from 'lucide-react'
import type { AgentDef, CheckpointDraft, DetectedRunner } from '@shared/session'

const PROVIDER_LABEL: Record<string, string> = {
  'claude-cli': 'Claude',
  'codex-cli': 'Codex',
  'claude-agent-sdk': 'Claude (SDK)',
}

const runnerLabel = (r: DetectedRunner): string =>
  `${PROVIDER_LABEL[r.provider] ?? r.provider} · ${r.kind === 'wsl' ? `WSL ${r.distro}` : 'Windows'}`

/**
 * Checkpoint — 작업 상태를 다음 세션으로 넘긴다.
 *
 * 세션 ID 가 아니라 **텍스트**를 넘기므로 실행 환경과 에이전트를 자유롭게 바꿀 수 있다.
 * 그래서 이 창에서 둘 다 새로 고르게 한다 — 이어가기(Resume)로는 못 하는 일이다.
 */
export default function Checkpoint({
  draft,
  runners,
  agents,
  onClose,
  onHandoff,
}: {
  draft: CheckpointDraft
  runners: DetectedRunner[]
  agents: AgentDef[]
  onClose: () => void
  onHandoff: (body: string, runnerId: string, agentName?: string) => void
}) {
  const [body, setBody] = useState(draft.body)
  const [runnerId, setRunnerId] = useState(runners[0]?.id ?? '')
  const [agentName, setAgentName] = useState<string>()
  const [copied, setCopied] = useState(false)

  const runner = runners.find((r) => r.id === runnerId)
  /** 고른 실행 환경에서 쓸 수 있는 에이전트만 */
  const usable = agents.filter((a) => {
    const okProject =
      !a.workspace.projects?.length || a.workspace.projects.includes(draft.projectPath)
    const okProvider =
      !a.workspace.providers?.length ||
      !runner ||
      a.workspace.providers.includes(runner.provider)
    return okProject && okProvider
  })
  /** 고른 에이전트가 환경 제한에 걸리면 선택을 비운다 */
  const effectiveAgent = usable.some((a) => a.name === agentName) ? agentName : undefined

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-crust/60 p-6 backdrop-blur-[2px]">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-mantle shadow-2xl ring-1 ring-surface0">
        <div className="flex items-start gap-3 px-5 pb-1 pt-5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal/15">
            <Flag className="h-4 w-4 text-teal" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-overlay1">체크포인트</div>
            <div className="mt-0.5 truncate text-[17px] text-text">{draft.title || '세션 인계'}</div>
          </div>
          <button
            onClick={onClose}
            title="닫기"
            className="rounded-md p-1.5 text-overlay1 hover:bg-surface0 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 pb-2 pt-3">
          <p className="text-[11px] leading-relaxed text-overlay1">
            지금까지의 작업을 정리했습니다. 전체 대화는 넘기지 않습니다 — 다음 세션의 컨텍스트를
            아끼기 위해서입니다. <span className="text-subtext0">남은 일</span>은 직접 채워주세요.
          </p>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            className="min-h-[300px] w-full resize-y rounded-lg bg-base p-3 font-mono text-[12px] leading-relaxed text-text outline-none ring-1 ring-transparent focus:ring-lavender/40"
          />

          <div>
            <div className="mb-1 text-[12px] text-subtext0">
              실행 환경
              <span className="ml-1.5 text-[11px] text-overlay1">
                텍스트로 넘기므로 바꿔도 됩니다
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {runners.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRunnerId(r.id)}
                  title={r.executable}
                  className={`rounded-md px-2 py-1 text-[12px] ${
                    runnerId === r.id
                      ? 'bg-mauve/20 text-mauve'
                      : 'bg-base text-overlay1 hover:text-subtext0'
                  }`}
                >
                  {runnerLabel(r)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[12px] text-subtext0">에이전트</div>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setAgentName(undefined)}
                className={`rounded-md px-2 py-1 text-[12px] ${
                  !effectiveAgent
                    ? 'bg-mauve/20 text-mauve'
                    : 'bg-base text-overlay1 hover:text-subtext0'
                }`}
              >
                없이 실행
              </button>
              {usable.map((a) => (
                <button
                  key={a.name}
                  onClick={() => setAgentName(a.name)}
                  title={a.description}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[12px] ${
                    effectiveAgent === a.name
                      ? 'bg-mauve/20 text-mauve'
                      : 'bg-base text-overlay1 hover:text-subtext0'
                  }`}
                >
                  <Bot className="h-3 w-3" />
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 pb-5 pt-3">
          <button
            onClick={() => {
              void navigator.clipboard.writeText(body)
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            }}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-subtext0 hover:bg-surface0 hover:text-text"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? '복사됨' : '복사'}
          </button>
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] text-subtext0 hover:bg-surface0 hover:text-text"
          >
            취소
          </button>
          <button
            disabled={!runnerId || !body.trim()}
            onClick={() => onHandoff(body, runnerId, effectiveAgent)}
            className="rounded-lg bg-teal/20 px-3.5 py-1.5 text-[12px] font-medium text-teal hover:bg-teal/30 disabled:opacity-40"
          >
            새 세션으로 인계
          </button>
        </div>
      </div>
    </div>
  )
}
