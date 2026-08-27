import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Copy, FileText, Loader2, Save, Sparkles, X } from 'lucide-react'
import type { DetectedRunner, ReportFacts } from '@shared/session'
import { runnerEnvironmentLabel } from '@shared/runner'
import { DEFAULT_REPORT_PROMPT, reportFileName } from '../lib/report-prompt'

interface Props {
  rangeLabel: string
  /** 저장 파일 이름에 넣을 기간 시작 시각 */
  rangeStart: number
  projectLabel?: string
  /** 보고서를 만들 CLI. 세션과 무관한 일회성 호출이다. */
  runners: DetectedRunner[]
  defaultRunnerId?: string
  /** 작업 디렉터리 — CLI 가 뜨는 자리일 뿐 파일을 읽지는 않는다 */
  cwd?: string
  facts?: ReportFacts
  onClose: () => void
}

export default function ReportDialog({
  rangeLabel,
  rangeStart,
  projectLabel,
  runners,
  defaultRunnerId,
  cwd,
  facts,
  onClose,
}: Props) {
  const [prompt, setPrompt] = useState(DEFAULT_REPORT_PROMPT)
  const [runnerId, setRunnerId] = useState(defaultRunnerId ?? runners[0]?.id ?? '')
  const [tab, setTab] = useState<'report' | 'facts'>('report')
  const [report, setReport] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savedTo, setSavedTo] = useState<string>()

  const runner = runners.find((r) => r.id === runnerId) ?? runners[0]

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const generate = async (): Promise<void> => {
    if (!facts || !runner || !cwd) return
    setBusy(true)
    setError(undefined)
    setSavedTo(undefined)
    try {
      const result = await window.api.generateReport(prompt, facts.text, runner, cwd)
      if (result.ok) {
        setReport(result.text)
        setTab('report')
      } else {
        setError(result.text)
      }
    } finally {
      setBusy(false)
    }
  }

  const shown = tab === 'report' ? report : (facts?.text ?? '')

  const copy = (): void => {
    void navigator.clipboard.writeText(shown).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  const save = (): void => {
    void window.api
      .saveReport(shown, reportFileName(rangeStart, projectLabel))
      .then((path) => path && setSavedTo(path))
  }

  const empty = facts?.sessionCount === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-crust/70 p-6 backdrop-blur-[2px]">
      <section className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-mantle shadow-2xl ring-1 ring-surface1">
        <header className="flex items-start gap-3 px-5 py-4">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sapphire/15 text-sapphire">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-text">기간 보고서</h2>
            <p className="mt-0.5 truncate text-[11px] text-overlay1">
              {rangeLabel}
              {projectLabel ? ` · ${projectLabel}` : ''}
              {facts ? ` · 세션 ${facts.sessionCount}건` : ''}
              {facts && facts.totalCostUsd > 0 ? ` · $${facts.totalCostUsd.toFixed(3)}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            title="닫기"
            className="rounded-md p-1.5 text-overlay1 hover:bg-surface0 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-1">
          {facts && facts.trimmedCount > 0 && (
            <div className="flex gap-2 rounded-lg bg-yellow/10 px-3 py-2 text-[11px] leading-relaxed text-yellow">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                분량이 많아 오래된 {facts.trimmedCount}건은 제목만 담았습니다. 기간을 좁히면 전부
                담깁니다.
              </span>
            </div>
          )}

          <label className="block">
            <span className="text-[11px] text-subtext0">보고서 요청</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              spellCheck={false}
              className="mt-1 h-24 w-full resize-y rounded-lg bg-base p-3 text-[12px] leading-relaxed text-text outline-none ring-1 ring-transparent focus:ring-lavender/40"
            />
          </label>

          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={runnerId}
              onChange={(event) => setRunnerId(event.target.value)}
              className="rounded-md bg-base px-2 py-1.5 text-[11px] text-subtext1 outline-none"
            >
              {runners.map((r) => (
                <option key={r.id} value={r.id}>
                  {runnerEnvironmentLabel(r)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !facts || empty || !runner || !cwd}
              onClick={() => void generate()}
              className="flex items-center gap-1.5 rounded-md bg-sapphire/20 px-3 py-1.5 text-[12px] font-medium text-sapphire hover:bg-sapphire/30 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {report ? '다시 만들기' : '보고서 만들기'}
            </button>
            {empty && <span className="text-[11px] text-overlay1">이 기간에 세션이 없습니다</span>}
            {!cwd && !empty && (
              <span className="text-[11px] text-yellow">프로젝트를 먼저 추가하세요</span>
            )}
          </div>

          {error && (
            <div className="whitespace-pre-wrap rounded-lg bg-red/10 px-3 py-2 text-[11px] leading-relaxed text-red">
              보고서를 만들지 못했습니다 — {error}
              <div className="mt-1 text-overlay1">
                «원본 사실» 을 복사해 직접 정리할 수 있습니다.
              </div>
            </div>
          )}

          <div className="flex items-center gap-0.5 rounded-lg bg-surface0/55 p-0.5">
            {(
              [
                ['report', '보고서'],
                ['facts', '원본 사실'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  tab === id ? 'bg-base/85 text-text shadow-sm' : 'text-overlay1 hover:text-subtext1'
                }`}
              >
                {label}
              </button>
            ))}
            {/* 모델이 쓴 문장만 남으면 맞는지 확인할 방법이 없다. 근거를 옆에 둔다. */}
            <span className="px-2 text-[10px] text-overlay1">
              {tab === 'facts' ? '모델을 거치지 않은 기록입니다' : ''}
            </span>
          </div>

          <textarea
            value={shown}
            onChange={(event) => tab === 'report' && setReport(event.target.value)}
            readOnly={tab === 'facts'}
            spellCheck={false}
            placeholder={busy ? '만드는 중…' : '«보고서 만들기» 를 누르세요'}
            className="h-72 w-full resize-y rounded-lg bg-base p-3 font-mono text-[12px] leading-relaxed text-text outline-none ring-1 ring-transparent placeholder:text-overlay0 focus:ring-lavender/40"
          />
        </div>

        <footer className="flex flex-wrap items-center gap-2 px-5 py-3">
          {savedTo && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-green" title={savedTo}>
              저장했습니다 — {savedTo}
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            disabled={!shown}
            onClick={copy}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-subtext1 hover:bg-surface0 hover:text-text disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? '복사함' : '복사'}
          </button>
          <button
            type="button"
            disabled={!shown}
            onClick={save}
            className="flex items-center gap-1.5 rounded-md bg-surface0 px-3 py-1.5 text-[12px] text-text hover:bg-surface1 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" /> 저장
          </button>
        </footer>
      </section>
    </div>
  )
}
