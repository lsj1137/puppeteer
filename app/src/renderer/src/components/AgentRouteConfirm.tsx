import { useEffect, useState } from 'react'
import { Bot, Loader2, WandSparkles } from 'lucide-react'
import type { RouteResult } from '@shared/session'

interface Props {
  instruction: string
  result?: RouteResult
  /** 라우터가 아직 돌고 있는지 */
  routing: boolean
  onStart: (agentName?: string) => void
  onCancel: () => void
}

/**
 * 자동 선택 결과 확인.
 *
 * 라우터가 고른 Agent 로 곧바로 시작하지 않는다 — 지침 전문이 그대로 모델에 실려 나가므로
 * 어떤 역할로 대화를 시작하는지는 사용자가 알고 정해야 한다. 후보를 바꾸거나 Agent 없이 시작할 수 있다.
 */
export default function AgentRouteConfirm({
  instruction,
  result,
  routing,
  onStart,
  onCancel,
}: Props) {
  const [chosen, setChosen] = useState<string | undefined>(result?.pick?.agentName)

  useEffect(() => {
    setChosen(result?.pick?.agentName)
  }, [result?.pick?.agentName])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-crust/70 p-6">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-surface1 bg-mantle p-5 shadow-2xl">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mauve/15 text-mauve">
            <WandSparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text">에이전트 자동 선택</div>
            <div className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-subtext0">
              {instruction}
            </div>
          </div>
        </div>

        {routing ? (
          <div className="flex items-center gap-2 rounded-lg bg-surface0/50 px-3 py-4 text-[12px] text-subtext1">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-mauve" />
            지시에 맞는 에이전트를 고르는 중입니다.
          </div>
        ) : (
          <>
            {/* 라우터가 왜 그렇게 골랐는지 — 못 골랐거나 실패한 이유도 여기 그대로 나온다. */}
            {result?.reason && (
              <div className="mb-2 rounded-lg bg-surface0/50 px-3 py-2 text-[12px] leading-relaxed text-subtext1">
                {result.reason}
              </div>
            )}
            <div className="min-h-0 flex-1 space-y-1 overflow-auto">
              <button
                type="button"
                onClick={() => setChosen(undefined)}
                className={`w-full rounded-lg px-3 py-2 text-left text-[13px] ${
                  chosen === undefined ? 'bg-surface1 text-text' : 'text-subtext1 hover:bg-surface0'
                }`}
              >
                에이전트 없이 실행
              </button>
              {(result?.candidates ?? []).map((candidate) => (
                <button
                  key={candidate.agentName}
                  type="button"
                  onClick={() => setChosen(candidate.agentName)}
                  className={`w-full rounded-lg px-3 py-2 text-left ${
                    chosen === candidate.agentName
                      ? 'bg-surface1 text-text'
                      : 'text-subtext1 hover:bg-surface0'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[13px] text-text">
                    <Bot className="h-3.5 w-3.5 shrink-0 text-mauve" />
                    {candidate.agentName}
                    {result?.pick?.agentName === candidate.agentName && (
                      <span className="rounded bg-mauve/15 px-1.5 py-0.5 text-[10px] text-mauve">
                        추천
                      </span>
                    )}
                  </span>
                  {candidate.description && (
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-overlay1">
                      {candidate.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-subtext1 hover:bg-surface0 hover:text-text"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onStart(chosen)}
            disabled={routing}
            className="rounded-md bg-mauve px-3 py-1.5 text-[12px] font-semibold text-crust hover:bg-pink disabled:cursor-not-allowed disabled:bg-surface1 disabled:text-overlay1"
          >
            {chosen ? `«${chosen}» 로 시작` : '에이전트 없이 시작'}
          </button>
        </div>
      </div>
    </div>
  )
}
