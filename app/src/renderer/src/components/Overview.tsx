import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, Folder, Loader2, ShieldAlert } from 'lucide-react'
import type {
  ApprovalRequest,
  CostTotals,
  ProjectStat,
  RunningSession,
  SessionStatus,
  StoredSession,
} from '@shared/session'
import {
  PERIOD_LABEL,
  describeRange,
  fromDateInput,
  resolveRange,
  type PeriodPreset,
} from '../lib/period'

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

const PRESETS: PeriodPreset[] = ['today', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'all']

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
  onOpenApproval,
}: {
  running: RunningSession[]
  approvals: ApprovalRequest[]
  statusLabel: (s: SessionStatus) => { label: string; color: string }
  onOpenProject: (path: string) => void
  onOpenSession: (sessionId: string, projectPath: string) => void
  onOpenApproval: (approval: ApprovalRequest) => void
}) {
  const [projects, setProjects] = useState<ProjectStat[]>([])
  const [cost, setCost] = useState<CostTotals>({ today: 0, month: 0, all: 0 })

  const [preset, setPreset] = useState<PeriodPreset>(
    () => (localStorage.getItem('ws.overviewPeriod') as PeriodPreset | null) ?? 'thisWeek',
  )
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [loading, setLoading] = useState(false)

  /**
   * 기준 시각을 상태로 붙잡는다. 렌더마다 `Date.now()` 를 부르면 구간이 매번
   * 새 값이 되어 조회가 끝없이 다시 돈다.
   */
  const [now, setNow] = useState(() => Date.now())
  const range = useMemo(
    () =>
      resolveRange(preset, now, {
        from: fromDateInput(customFrom),
        to: fromDateInput(customTo),
      }),
    [preset, now, customFrom, customTo],
  )

  useEffect(() => {
    void window.api.overviewStats().then((s) => {
      setProjects(s.projects)
      setCost(s.cost)
    })
  }, [running.length, approvals.length])

  const reloadSessions = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setSessions(
        await window.api.overviewSessions(range.from, range.to, projectFilter || undefined),
      )
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to, projectFilter])

  useEffect(() => {
    void reloadSessions()
  }, [reloadSessions, running.length])

  const choosePreset = (next: PeriodPreset): void => {
    setPreset(next)
    localStorage.setItem('ws.overviewPeriod', next)
    // 같은 프리셋을 다시 누르는 것이 «지금 기준으로 새로고침» 이기도 하다
    setNow(Date.now())
  }

  const totalCost = sessions.reduce((sum, s) => sum + s.costUsd, 0)

  const Stat = ({ label, value }: { label: string; value: string }): React.ReactElement => (
    <div className="rounded-lg bg-mantle px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-overlay1">{label}</div>
      <div className="mt-1 font-mono text-xl tabular-nums text-text">{value}</div>
    </div>
  )

  return (
    // `h-full min-h-0` 이 없으면 내용 높이만큼 늘어나 바깥에서 잘린다. 스크롤이 생기지 않는다.
    <div className="h-full min-h-0 space-y-5 overflow-y-auto px-5 py-4">
      <div>
        <h1 className="mb-3 text-[16px] font-semibold text-text">Overview</h1>
        <div className="grid grid-cols-4 gap-3">
          <Stat label="실행 중" value={String(running.length)} />
          <Stat label="승인 대기" value={String(approvals.length)} />
          <Stat label="오늘 비용" value={`$${cost.today.toFixed(2)}`} />
          <Stat label="이번 달" value={`$${cost.month.toFixed(2)}`} />
        </div>
      </div>

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
                onClick={() => onOpenApproval(a)}
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
        {/* 경로 줄을 제목 툴팁으로 옮겨 세 줄을 두 줄로 줄였다 */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-1.5">
          {projects.map((p) => {
            const live = running.filter((r) => r.projectPath === p.path).length
            return (
              <button
                key={p.path}
                onClick={() => onOpenProject(p.path)}
                title={p.path}
                className="rounded-lg bg-mantle px-3 py-2 text-left hover:bg-surface0/60"
              >
                <div className="flex items-center gap-1.5">
                  <Folder className="h-3.5 w-3.5 shrink-0 text-sapphire" />
                  <span className="flex-1 truncate text-[13px] font-medium text-text">
                    {p.alias || baseName(p.path)}
                  </span>
                  {live > 0 && (
                    <span className="shrink-0 rounded bg-green/20 px-1 text-[10px] text-green">
                      {live}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-overlay1">
                  <span>{p.sessionCount}회</span>
                  <span className="font-mono">${p.totalCostUsd.toFixed(2)}</span>
                  <span className="ml-auto truncate">{timeLabel(p.lastSessionAt)}</span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-overlay1">
            세션 {sessions.length}
          </h2>
          <span className="flex items-center gap-1 text-[11px] text-subtext0">
            <CalendarRange className="h-3.5 w-3.5" />
            {describeRange(preset, range)}
          </span>
          {totalCost > 0 && (
            <span className="font-mono text-[11px] tabular-nums text-overlay1">
              ${totalCost.toFixed(3)}
            </span>
          )}
          {loading && <Loader2 className="h-3 w-3 animate-spin text-overlay1" />}
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-lg bg-surface0/55 p-0.5">
            {[...PRESETS, 'custom' as const].map((id) => (
              <button
                key={id}
                onClick={() => choosePreset(id)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  preset === id
                    ? 'bg-base/85 text-text shadow-sm'
                    : 'text-overlay1 hover:text-subtext1'
                }`}
              >
                {PERIOD_LABEL[id]}
              </button>
            ))}
          </div>

          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="rounded-md bg-surface0/55 px-2 py-1 text-[11px] text-subtext1 outline-none"
          >
            <option value="">전체 프로젝트</option>
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {p.alias || baseName(p.path)}
              </option>
            ))}
          </select>

          {preset === 'custom' && (
            <span className="flex items-center gap-1 text-[11px] text-overlay1">
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="rounded-md bg-surface0/55 px-2 py-1 text-subtext1 outline-none"
              />
              –
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(event) => setCustomTo(event.target.value)}
                className="rounded-md bg-surface0/55 px-2 py-1 text-subtext1 outline-none"
              />
            </span>
          )}
        </div>

        <div className="space-y-0.5">
          {sessions.map((s) => {
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
          {sessions.length === 0 && !loading && (
            <div className="px-3 py-2 text-[12px] text-overlay1">
              {preset === 'custom' && !customFrom && !customTo
                ? '날짜를 고르세요'
                : '이 기간에 세션이 없습니다'}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
