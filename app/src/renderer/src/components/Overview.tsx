import { useEffect, useState } from 'react'
import { CornerDownLeft, Folder, Loader2, Sparkles, ShieldAlert } from 'lucide-react'
import type {
  ApprovalRequest,
  DetectedRunner,
  RouteCandidate,
  RouteResult,
  CostTotals,
  ProjectStat,
  RunningSession,
  SessionStatus,
  StoredSession,
} from '@shared/session'

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

const timeLabel = (ms: number | null): string =>
  ms
    ? new Date(ms).toLocaleString('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

/** 전체 프로젝트·세션·비용을 한 화면에서 본다 (기획서 3장 Overview) */
export default function Overview({
  running,
  approvals,
  statusLabel,
  onOpenProject,
  onOpenSession,
  runner,
  routeCwd,
  onRunAgent,
}: {
  running: RunningSession[]
  approvals: ApprovalRequest[]
  statusLabel: (s: SessionStatus) => { label: string; color: string }
  onOpenProject: (path: string) => void
  onOpenSession: (sessionId: string, projectPath: string) => void
  /** 라우터 호출에 쓸 러너. 없으면 지시 입력을 막는다. */
  runner?: DetectedRunner
  routeCwd?: string
  onRunAgent: (c: RouteCandidate, instruction: string) => Promise<void>
}) {
  const [instruction, setInstruction] = useState('')
  const [routing, setRouting] = useState(false)
  const [result, setResult] = useState<RouteResult>()
  /** 라우터 제안을 사용자가 바꾼 경우 */
  const [override, setOverride] = useState<RouteCandidate>()

  const chosen = override ?? result?.pick

  async function findAgent(): Promise<void> {
    const text = instruction.trim()
    if (!text || !runner || !routeCwd || routing) return
    setRouting(true)
    setResult(undefined)
    setOverride(undefined)
    try {
      setResult(await window.api.routeInstruction(text, runner, routeCwd))
    } catch (e) {
      setResult({
        candidates: [],
        reason: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setRouting(false)
    }
  }
  const [projects, setProjects] = useState<ProjectStat[]>([])
  const [recent, setRecent] = useState<StoredSession[]>([])
  const [cost, setCost] = useState<CostTotals>({ today: 0, month: 0, all: 0 })

  useEffect(() => {
    void window.api.overviewStats().then((s) => {
      setProjects(s.projects)
      setRecent(s.recent)
      setCost(s.cost)
    })
  }, [running.length, approvals.length])

  const Stat = ({ label, value }: { label: string; value: string }): React.ReactElement => (
    <div className="rounded-lg bg-mantle px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-overlay1">{label}</div>
      <div className="mt-1 font-mono text-xl tabular-nums text-text">{value}</div>
    </div>
  )

  return (
    <div className="space-y-5 overflow-auto px-5 py-4">
      <div>
        <h1 className="mb-3 text-[16px] font-semibold text-text">Overview</h1>
        <div className="grid grid-cols-4 gap-3">
          <Stat label="실행 중" value={String(running.length)} />
          <Stat label="승인 대기" value={String(approvals.length)} />
          <Stat label="오늘 비용" value={`$${cost.today.toFixed(2)}`} />
          <Stat label="이번 달" value={`$${cost.month.toFixed(2)}`} />
        </div>
      </div>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-overlay1">
          <Sparkles className="h-3.5 w-3.5" />
          지시로 에이전트 찾기
        </h2>
        <div className="rounded-lg bg-mantle p-2.5">
          <div className="flex items-start gap-2">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void findAgent()
                }
              }}
              rows={2}
              placeholder={
                runner
                  ? '무엇을 해야 하는지 적으면 알맞은 에이전트를 찾아줍니다'
                  : '실행 환경을 찾지 못했습니다'
              }
              disabled={!runner}
              className="min-h-[46px] flex-1 resize-none rounded-md bg-base px-2.5 py-2 text-[13px] leading-relaxed text-text outline-none placeholder:text-overlay1 disabled:opacity-50"
            />
            <button
              onClick={() => void findAgent()}
              disabled={!instruction.trim() || !runner || routing}
              className="flex items-center gap-1.5 rounded-md bg-lavender/20 px-3 py-2 text-[12px] font-medium text-lavender hover:bg-lavender/30 disabled:opacity-40"
            >
              {routing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CornerDownLeft className="h-3.5 w-3.5" />
              )}
              찾기
            </button>
          </div>

          {result && (
            <div className="mt-2 rounded-md bg-base p-2.5">
              {chosen ? (
                <>
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="rounded bg-lavender/20 px-1.5 py-0.5 font-medium text-lavender">
                      {chosen.agentName}
                    </span>
                    <span className="text-overlay1">·</span>
                    <span className="truncate text-subtext1">{chosen.projectName}</span>
                  </div>
                  {result.reason && (
                    <div className="mt-1.5 text-[12px] leading-relaxed text-subtext0">
                      {result.reason}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => {
                        const text = instruction.trim()
                        setInstruction('')
                        setResult(undefined)
                        setOverride(undefined)
                        void onRunAgent(chosen, text)
                      }}
                      className="rounded-md bg-green/20 px-3 py-1.5 text-[12px] font-medium text-green hover:bg-green/30"
                    >
                      이 에이전트로 실행
                    </button>
                    <button
                      onClick={() => setResult(undefined)}
                      className="rounded-md px-2 py-1.5 text-[12px] text-overlay1 hover:text-subtext1"
                    >
                      취소
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-[12px] leading-relaxed text-peach">{result.reason}</div>
              )}

              {result.candidates.length > 1 && (
                <div className="mt-2.5">
                  <div className="mb-1 text-[11px] text-overlay1">직접 고르기</div>
                  <div className="flex flex-wrap gap-1">
                    {result.candidates.map((c) => (
                      <button
                        key={`${c.projectPath}/${c.agentName}`}
                        onClick={() => setOverride(c)}
                        title={c.description}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          chosen?.agentName === c.agentName && chosen.projectPath === c.projectPath
                            ? 'bg-lavender/20 text-lavender'
                            : 'bg-surface0 text-subtext0 hover:text-text'
                        }`}
                      >
                        {c.agentName}
                        <span className="ml-1 text-overlay1">{c.projectName}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {running.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-overlay1">
            실행 중인 세션
          </h2>
          <div className="space-y-1">
            {running.map((r) => (
              <button
                key={r.id}
                onClick={() => onOpenSession(r.id, r.projectPath)}
                className="flex w-full items-center gap-2 rounded-md bg-green/10 px-3 py-2 text-left text-[13px] hover:bg-green/15"
              >
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-green" />
                <span className="flex-1 truncate text-subtext1">{r.title}</span>
                <span className="shrink-0 text-overlay1">{baseName(r.projectPath)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {approvals.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-overlay1">
            승인 대기
          </h2>
          <div className="space-y-1">
            {approvals.map((a) => (
              <button
                key={a.id}
                onClick={() => onOpenSession(a.sessionId, a.cwd)}
                className="flex w-full items-center gap-2 rounded-md bg-peach/10 px-3 py-2 text-left text-[13px] hover:bg-peach/15"
              >
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-peach" />
                <span className="font-mono text-subtext1">{a.tool}</span>
                <span className="flex-1 truncate text-overlay1">{a.cwd}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-overlay1">
          프로젝트 {projects.length}
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {projects.map((p) => {
            const live = running.filter((r) => r.projectPath === p.path).length
            return (
              <button
                key={p.path}
                onClick={() => onOpenProject(p.path)}
                className="rounded-lg bg-mantle px-3.5 py-3 text-left hover:bg-surface0/60"
              >
                <div className="mb-1 flex items-center gap-2">
                  <Folder className="h-4 w-4 shrink-0 text-sapphire" />
                  <span className="flex-1 truncate text-sm font-medium text-text">
                    {baseName(p.path)}
                  </span>
                  {live > 0 && (
                    <span className="shrink-0 rounded bg-green/20 px-1.5 text-[11px] text-green">
                      {live} 실행 중
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-overlay1">{p.path}</div>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-subtext0">
                  <span>세션 {p.sessionCount}</span>
                  <span className="font-mono">${p.totalCostUsd.toFixed(3)}</span>
                  <span className="ml-auto text-overlay1">{timeLabel(p.lastSessionAt)}</span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-overlay1">
          최근 세션
        </h2>
        <div className="space-y-0.5">
          {recent.map((s) => {
            const st = statusLabel(s.status)
            return (
              <button
                key={s.id}
                onClick={() => onOpenSession(s.id, s.projectPath)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-surface0"
              >
                <span className={`w-16 shrink-0 ${st.color}`}>{st.label}</span>
                <span className="flex-1 truncate text-subtext1">{s.title || '(제목 없음)'}</span>
                <span className="shrink-0 text-overlay1">{baseName(s.projectPath)}</span>
                <span className="w-14 shrink-0 text-right font-mono text-overlay1">
                  {s.costUsd > 0 ? `$${s.costUsd.toFixed(3)}` : ''}
                </span>
                <span className="w-24 shrink-0 text-right text-overlay1">
                  {timeLabel(s.startedAt)}
                </span>
              </button>
            )
          })}
          {recent.length === 0 && <div className="px-3 text-[12px] text-overlay1">세션 없음</div>}
        </div>
      </section>
    </div>
  )
}
