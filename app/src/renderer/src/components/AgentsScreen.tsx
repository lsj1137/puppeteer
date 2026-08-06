import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  CornerDownLeft,
  Download,
  FolderInput,
  Link2,
  Loader2,
  RefreshCw,
  Pencil,
  Plus,
  Sparkles,
} from 'lucide-react'
import AgentUpdate from './AgentUpdate'
import type {
  AgentDef,
  UpdateCheck,
  DetectedRunner,
  RouteCandidate,
  RouteResult,
  StoredProject,
} from '@shared/session'

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/**
 * 에이전트를 한곳에서 관리하고, 프로젝트를 고르지 않은 채로 지시를 내리는 화면.
 * 지시는 라우터를 거쳐 어떤 에이전트로 갈지 정한 뒤에야 실행된다.
 */
export default function AgentsScreen({
  agents,
  projects,
  runner,
  runnerMissingReason = '실행 환경을 찾지 못했습니다',
  routeCwd,
  onRunAgent,
  onEdit,
  onNew,
  onImport,
  onReload,
}: {
  agents: AgentDef[]
  projects: StoredProject[]
  /** 라우터 호출에 쓸 러너. 없으면 지시 입력을 막는다. */
  runner?: DetectedRunner
  runnerMissingReason?: string
  routeCwd?: string
  onRunAgent: (c: RouteCandidate, projectPath: string, instruction: string) => Promise<void>
  onEdit: (agent: AgentDef) => void
  onNew: () => void
  onImport: () => void
  onReload: () => void
}) {
  const [instruction, setInstruction] = useState('')
  const [routing, setRouting] = useState(false)
  const [result, setResult] = useState<RouteResult>()
  const [override, setOverride] = useState<RouteCandidate>()
  const [target, setTarget] = useState<string>()
  /** 아직 라이브러리로 안 옮긴 프로젝트 파일들 */
  const [strays, setStrays] = useState<AgentDef[]>([])
  const [exporting, setExporting] = useState<string>()
  /** 연결된 원본 확인 결과 — 이름별로 들고 있다 */
  const [checks, setChecks] = useState<Record<string, UpdateCheck>>({})
  const [checking, setChecking] = useState(false)
  const [reviewing, setReviewing] = useState<string>()

  const linked = agents.filter((a) => a.workspace.source)

  /** 확인은 사용자가 눌렀을 때만 한다. 화면을 열 때마다 외부 요청을 보내지 않는다. */
  async function checkAll(): Promise<void> {
    if (checking || linked.length === 0) return
    setChecking(true)
    try {
      const results = await Promise.all(linked.map((a) => window.api.checkAgentUpdate(a.name)))
      setChecks(Object.fromEntries(results.map((r) => [r.name, r])))
    } finally {
      setChecking(false)
    }
  }

  const chosen = override ?? result?.pick
  const targets = chosen?.projects ?? []
  const runIn = target && targets.includes(target) ? target : targets[0]

  const scanStrays = useCallback(async () => {
    const found = await Promise.all(projects.map((p) => window.api.scanProjectAgents(p.path)))
    // 이미 라이브러리에 같은 이름이 있으면 가져오기 후보로 보여줄 이유가 없다
    const known = new Set(agents.map((a) => a.name))
    setStrays(found.flat().filter((a) => !known.has(a.name)))
  }, [projects, agents])

  useEffect(() => {
    void scanStrays()
  }, [scanStrays])

  async function findAgent(): Promise<void> {
    const text = instruction.trim()
    if (!text || !runner || !routeCwd || routing) return
    setRouting(true)
    setResult(undefined)
    setOverride(undefined)
    setTarget(undefined)
    try {
      setResult(await window.api.routeInstruction(text, runner, routeCwd))
    } catch (e) {
      setResult({ candidates: [], reason: e instanceof Error ? e.message : String(e) })
    } finally {
      setRouting(false)
    }
  }

  return (
    <div className="space-y-5 overflow-auto px-5 py-4">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-[16px] font-semibold text-text">Agents</h1>
        {linked.length > 0 && (
          <button
            onClick={() => void checkAll()}
            disabled={checking}
            title={`연결된 에이전트 ${linked.length}개의 원본을 확인합니다`}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-subtext1 hover:bg-surface0 hover:text-text disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
            업데이트 확인
          </button>
        )}
        <button
          onClick={onImport}
          className="flex items-center gap-1.5 rounded-md bg-surface0 px-3 py-1.5 text-[12px] text-subtext1 hover:bg-surface1 hover:text-text"
        >
          <Link2 className="h-3.5 w-3.5" /> 가져오기
        </button>
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 rounded-md bg-mauve/20 px-3 py-1.5 text-[12px] font-medium text-mauve hover:bg-mauve/30"
        >
          <Plus className="h-3.5 w-3.5" /> 새 에이전트
        </button>
      </div>

      {/* ── 지시 → 에이전트 라우팅 ────────────────────────── */}
      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-overlay1">
          <Sparkles className="h-3.5 w-3.5" />
          에이전트를 고르지 않고 지시하기
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
                  : runnerMissingReason
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
                  <span className="rounded bg-lavender/20 px-1.5 py-0.5 text-[13px] font-medium text-lavender">
                    {chosen.agentName}
                  </span>
                  {result.reason && (
                    <div className="mt-1.5 text-[12px] leading-relaxed text-subtext0">
                      {result.reason}
                    </div>
                  )}

                  <div className="mt-2">
                    <div className="mb-1 text-[11px] text-overlay1">
                      {targets.length > 1 ? '어느 프로젝트에서 실행할까요' : '실행 위치'}
                    </div>
                    {targets.length === 0 ? (
                      <div className="text-[12px] text-peach">
                        이 에이전트의 적용 대상 프로젝트가 등록되어 있지 않습니다.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {targets.map((path) => (
                          <button
                            key={path}
                            onClick={() => setTarget(path)}
                            title={path}
                            className={`rounded px-1.5 py-0.5 text-[11px] ${
                              runIn === path
                                ? 'bg-green/20 text-green'
                                : 'bg-surface0 text-subtext0 hover:text-text'
                            }`}
                          >
                            {baseName(path)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      disabled={!runIn}
                      onClick={() => {
                        if (!runIn) return
                        const text = instruction.trim()
                        setInstruction('')
                        setResult(undefined)
                        setOverride(undefined)
                        void onRunAgent(chosen, runIn, text)
                      }}
                      className="rounded-md bg-green/20 px-3 py-1.5 text-[12px] font-medium text-green hover:bg-green/30 disabled:opacity-40"
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
                        key={c.agentName}
                        onClick={() => {
                          setOverride(c)
                          setTarget(undefined)
                        }}
                        title={c.description}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          chosen?.agentName === c.agentName
                            ? 'bg-lavender/20 text-lavender'
                            : 'bg-surface0 text-subtext0 hover:text-text'
                        }`}
                      >
                        {c.agentName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── 라이브러리 ────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-overlay1">
          라이브러리 {agents.length}
        </h2>

        {agents.length === 0 ? (
          <div className="rounded-lg bg-mantle px-4 py-6 text-center text-[12px] text-overlay1">
            아직 에이전트가 없습니다. 오른쪽 위 «새 에이전트» 로 만들어보세요.
          </div>
        ) : (
          /* 카드 최소 280px — 창이 좁아지면 2단, 1단으로 접힌다.
             컨테이너를 3단 폭에서 끊어 그보다 넓어져도 4단이 되지 않게 한다. */
          <div
            className="grid max-w-[912px] gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {agents.map((a) => (
              <div
                key={a.name}
                className="group flex flex-col gap-2 rounded-lg bg-mantle p-3 ring-1 ring-transparent transition hover:ring-surface0 motion-reduce:transition-none"
              >
                <div className="flex items-start gap-2">
                  <Bot className="mt-0.5 h-4 w-4 shrink-0 text-mauve" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-text">
                    {a.name}
                  </span>
                  {a.workspace.source && (
                    <Link2
                      className="h-3 w-3 shrink-0 text-overlay1"
                      aria-label="원본과 연결됨"
                    />
                  )}

                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 motion-reduce:transition-none">
                    <div>
                      <button
                        onClick={() => setExporting(exporting === a.name ? undefined : a.name)}
                        title="프로젝트로 내보내기"
                        className="rounded p-1 text-overlay1 hover:bg-surface0 hover:text-text"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      onClick={() => onEdit(a)}
                      title="편집"
                      className="rounded p-1 text-overlay1 hover:bg-surface0 hover:text-text"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {a.description && (
                  <p className="line-clamp-2 text-[12px] leading-relaxed text-subtext0">
                    {a.description}
                  </p>
                )}

                {checks[a.name]?.changed && (
                  <button
                    onClick={() => setReviewing(a.name)}
                    className="flex items-center gap-1.5 rounded-md bg-sapphire/15 px-2 py-1 text-[11px] font-medium text-sapphire hover:bg-sapphire/25"
                  >
                    <RefreshCw className="h-3 w-3" /> 원본이 바뀌었습니다 · 변경분 보기
                  </button>
                )}
                {checks[a.name]?.error && (
                  <div className="truncate text-[11px] text-peach" title={checks[a.name].error}>
                    확인 실패 · {checks[a.name].error}
                  </div>
                )}
                {checks[a.name] && !checks[a.name].changed && !checks[a.name].error && (
                  <div className="text-[11px] text-overlay1">최신입니다</div>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-1">
                  {a.workspace.projects?.length ? (
                    a.workspace.projects.map((p) => (
                      <span
                        key={p}
                        title={p}
                        className="rounded bg-sapphire/15 px-1.5 py-0.5 text-[11px] text-sapphire"
                      >
                        {baseName(p)}
                      </span>
                    ))
                  ) : (
                    <span className="rounded bg-surface0 px-1.5 py-0.5 text-[11px] text-subtext0">
                      전체 프로젝트
                    </span>
                  )}
                  {a.model && (
                    <span className="ml-auto text-[11px] text-overlay1">{a.model}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {exporting &&
        createPortal(
          <ExportAgentDialog
            agentName={exporting}
            projects={projects}
            onClose={() => setExporting(undefined)}
          />,
          document.body,
        )}

      {reviewing && checks[reviewing]?.fetched && (
        <AgentUpdate
          check={checks[reviewing]}
          current={agents.find((a) => a.name === reviewing)!}
          onClose={() => setReviewing(undefined)}
          onApplied={() => {
            setChecks((c) => ({ ...c, [reviewing]: { ...c[reviewing], changed: false } }))
            setReviewing(undefined)
            onReload()
          }}
        />
      )}

      {/* ── 프로젝트에 남아 있는 파일 ─────────────────────── */}
      {strays.length > 0 && (
        <section>
          <h2 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-overlay1">
            프로젝트에 남아 있는 에이전트 {strays.length}
          </h2>
          <div className="mb-2 text-[11px] text-overlay1">
            가져오면 라이브러리로 옮겨집니다. 원본 파일은 남지 않습니다.
          </div>
          <div className="space-y-1.5">
            {strays.map((a) => (
              <div
                key={`${a.projectPath}/${a.name}`}
                className="flex items-center gap-2 rounded-lg bg-mantle p-2.5"
              >
                <Bot className="h-4 w-4 shrink-0 text-overlay1" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-text">{a.name}</div>
                  <div className="truncate text-[11px] text-overlay1">{a.projectPath}</div>
                </div>
                <button
                  onClick={async () => {
                    if (!a.projectPath) return
                    await window.api.importAgent(a.projectPath, a.name)
                    onReload()
                    void scanStrays()
                  }}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-surface0 px-2.5 py-1 text-[12px] text-subtext1 hover:bg-surface1 hover:text-text"
                >
                  <FolderInput className="h-3.5 w-3.5" /> 가져오기
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ExportAgentDialog({
  agentName,
  projects,
  onClose,
}: {
  agentName: string
  projects: StoredProject[]
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function exportTo(
    projectPath: string,
    format: 'claude-agent' | 'codex-skill',
  ): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await window.api.exportAgent(agentName, projectPath, format)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-crust/60 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[min(32rem,calc(100vh-3rem))] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-mantle shadow-2xl ring-1 ring-surface1">
        <div className="px-5 pb-3 pt-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-overlay1">
            Agent 내보내기
          </div>
          <div className="mt-1 font-mono text-[16px] text-text">{agentName}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-subtext0">
            Claude Agent는 필요할 때 선택하거나 위임하고, Codex Skill은 작업 내용이 설명과
            맞을 때 자동으로 불러올 수 있습니다.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 pb-2">
          {projects.length === 0 ? (
            <div className="rounded-lg bg-base px-3 py-4 text-center text-[12px] text-overlay1">
              먼저 프로젝트를 등록해 주세요.
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <div key={project.path} className="rounded-lg bg-base p-3">
                  <div className="truncate text-[12px] font-medium text-text" title={project.path}>
                    {baseName(project.path)}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-overlay1">
                    {project.path}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void exportTo(project.path, 'claude-agent')}
                      className="rounded-md bg-lavender/15 px-2.5 py-2 text-left hover:bg-lavender/25 disabled:opacity-40"
                    >
                      <div className="text-[12px] font-medium text-lavender">Claude Agent</div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-overlay1">
                        .claude/agents/{agentName}.md
                      </div>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void exportTo(project.path, 'codex-skill')}
                      className="rounded-md bg-sapphire/15 px-2.5 py-2 text-left hover:bg-sapphire/25 disabled:opacity-40"
                    >
                      <div className="text-[12px] font-medium text-sapphire">Codex Skill</div>
                      <div className="mt-0.5 truncate font-mono text-[10px] text-overlay1">
                        .agents/skills/{agentName}/SKILL.md
                      </div>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end px-5 pb-5 pt-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] text-subtext0 hover:bg-surface0 hover:text-text disabled:opacity-40"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  )
}
