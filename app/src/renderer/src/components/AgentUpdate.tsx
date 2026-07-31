import { useState } from 'react'
import { AlertTriangle, GitCompare, X } from 'lucide-react'
import type { AgentDef, UpdateCheck } from '@shared/session'
import Code from './Code'
import { diffStat, unifiedDiff } from '../lib/diff'

/**
 * 연결된 원본의 변경분 검토.
 *
 * 지침·설명은 원본을 따르되 **권한과 적용 대상은 로컬 값을 유지한다.**
 * 원본이 도구를 더 요구하도록 바뀌었다면 그 사실만 알리고, 켜는 것은 사용자가 한다.
 */
export default function AgentUpdate({
  check,
  current,
  onClose,
  onApplied,
}: {
  check: UpdateCheck
  /** 지금 저장돼 있는 에이전트 — 권한 비교에 쓴다 */
  current: AgentDef
  onClose: () => void
  onApplied: (a: AgentDef) => void
}) {
  const fetched = check.fetched
  const granted = current.workspace.allowedTools ?? []
  /** 원본이 새로 요구했는데 아직 안 켜준 도구 */
  const newlyRequested = (fetched?.requested.allowedTools ?? []).filter((t) => !granted.includes(t))

  const [grant, setGrant] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  if (!fetched) return null

  const diff = unifiedDiff(check.current ?? '', fetched.agent.instructions)
  const stat = diffStat(check.current ?? '', fetched.agent.instructions)
  const descChanged = fetched.agent.description !== current.description
  const modelChanged = fetched.requested.model !== current.model

  async function apply(): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      const next = await window.api.applyAgentUpdate(check.name, {
        tools: grant.length ? [...granted, ...grant] : undefined,
      })
      if (next) onApplied(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-crust/60 p-6 backdrop-blur-[2px]">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-mantle shadow-2xl ring-1 ring-surface0">
        <div className="flex items-start gap-3 px-5 pb-1 pt-5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sapphire/15">
            <GitCompare className="h-4 w-4 text-sapphire" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-overlay1">원본 변경분</div>
            <div className="mt-0.5 truncate font-mono text-[17px] text-text">{check.name}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-overlay1 hover:bg-surface0 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 pb-2 pt-3">
          <div className="flex items-center gap-2 text-[11px] text-overlay1">
            <span className="truncate" title={current.workspace.source?.url}>
              {current.workspace.source?.url}
            </span>
            <span className="ml-auto shrink-0 font-mono">
              <span className="text-green">+{stat.added}</span>{' '}
              <span className="text-red">−{stat.removed}</span>
            </span>
          </div>

          {(descChanged || modelChanged) && (
            <div className="space-y-1 rounded-lg bg-base px-3 py-2 text-[12px]">
              {descChanged && (
                <div>
                  <span className="text-overlay1">설명 </span>
                  <span className="text-subtext0">{fetched.agent.description}</span>
                </div>
              )}
              {modelChanged && (
                <div>
                  <span className="text-overlay1">모델 </span>
                  <span className="text-subtext0">
                    {current.model ?? '기본값'} → {fetched.requested.model ?? '기본값'}
                  </span>
                  <span className="ml-1.5 text-[11px] text-overlay1">
                    (모델은 지금 값을 유지합니다)
                  </span>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="mb-1 text-[12px] text-subtext0">지침 변경</div>
            {diff ? (
              <div className="max-h-72 overflow-auto rounded-lg">
                <Code code={diff} language="diff" />
              </div>
            ) : (
              <div className="rounded-lg bg-base px-3 py-2 text-[12px] text-overlay1">
                지침은 그대로입니다.
              </div>
            )}
          </div>

          {newlyRequested.length > 0 && (
            <div className="rounded-lg bg-peach/10 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-peach">
                <AlertTriangle className="h-3.5 w-3.5" />
                원본이 도구를 더 요구합니다
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-subtext0">
                켜지 않으면 지금 권한 그대로 갱신됩니다. 필요한 것만 직접 켜세요.
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {newlyRequested.map((t) => {
                  const on = grant.includes(t)
                  return (
                    <button
                      key={t}
                      onClick={() => setGrant((v) => (on ? v.filter((x) => x !== t) : [...v, t]))}
                      className={`rounded-md px-2 py-1 font-mono text-[12px] ${
                        on ? 'bg-peach/20 text-peach' : 'bg-base text-overlay1 hover:text-subtext0'
                      }`}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red/10 px-3 py-2 text-[12px] text-red">{error}</div>
          )}
        </div>

        <div className="flex items-center gap-3 px-5 pb-5 pt-3">
          <span className="flex-1 text-[11px] text-overlay1">
            적용 대상과 기존 권한은 그대로 둡니다
          </span>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] text-subtext0 hover:bg-surface0 hover:text-text"
          >
            나중에
          </button>
          <button
            disabled={busy}
            onClick={() => void apply()}
            className="rounded-lg bg-lavender/20 px-3.5 py-1.5 text-[12px] font-medium text-lavender hover:bg-lavender/30 disabled:opacity-40"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  )
}
