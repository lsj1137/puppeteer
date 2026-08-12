import { useCallback, useEffect, useState } from 'react'
import {
  ArrowUpToLine,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Globe,
  Loader2,
  NotebookPen,
  Sparkles,
  X,
  Search,
  TriangleAlert,
} from 'lucide-react'
import type { MemoryEdit, MemoryEntry, MemoryProposal, MemoryScope } from '@shared/session'

const SCOPES: {
  key: MemoryScope
  label: string
  hint: string
  icon: typeof Globe
  /** 기본으로 접어 둘지 */
  collapsed?: boolean
}[] = [
  {
    key: 'global',
    label: '전역',
    hint: '모든 프로젝트에 적용됩니다. 실행 환경마다 파일이 따로입니다.',
    icon: Globe,
  },
  { key: 'project', label: '프로젝트', hint: '그 프로젝트에서만 적용됩니다.', icon: Folder },
  {
    key: 'agent',
    label: '에이전트',
    hint: '그 에이전트로 실행할 때만 지침 뒤에 붙습니다.',
    icon: Bot,
  },
  // 직접 쓴 것이 아니라 쌓인 것이라 맨 아래에 접어 둔다
  {
    key: 'auto',
    label: '자동 메모리',
    hint: '세션이 스스로 쌓아 둔 메모리입니다. Claude Code 전용 저장소입니다.',
    icon: NotebookPen,
    collapsed: true,
  },
]

const when = (ms?: number): string =>
  ms
    ? new Date(ms).toLocaleString('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

/**
 * Memory 편집.
 *
 * CLI 가 실제로 읽는 파일을 그대로 고친다. 앱이 따로 보관하지 않으므로
 * 앱 밖에서 CLI 를 직접 실행해도 똑같이 적용된다.
 */
export default function MemoryScreen() {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [selected, setSelected] = useState<string>()
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [history, setHistory] = useState<MemoryEdit[]>([])
  const [proposals, setProposals] = useState<MemoryProposal[]>([])
  const [proposalBusy, setProposalBusy] = useState<number>()
  const [proposalError, setProposalError] = useState<string>()
  const [promotionOpen, setPromotionOpen] = useState(false)
  const [promotionTarget, setPromotionTarget] = useState('')
  const [promotionText, setPromotionText] = useState('')
  const [promotionBusy, setPromotionBusy] = useState(false)
  const [promotionMessage, setPromotionMessage] = useState<string>()
  const [filter, setFilter] = useState('')
  /** 지금 열어둔 항목의 원본 — 저장 여부 판단용 */
  const [original, setOriginal] = useState('')
  const [closed, setClosed] = useState<Record<string, boolean>>(
    () => Object.fromEntries(SCOPES.filter((s) => s.collapsed).map((s) => [s.key, true])),
  )

  const entry = entries.find((e) => e.id === selected)
  const dirty = draft !== original
  const q = filter.trim().toLowerCase()
  const visible = q
    ? entries.filter(
        (e) =>
          e.label.toLowerCase().includes(q) ||
          (e.group ?? '').toLowerCase().includes(q),
      )
    : entries

  const load = useCallback(async () => {
    const [list, pending] = await Promise.all([
      window.api.listMemories(),
      window.api.memoryProposals(),
    ])
    setEntries(list)
    setProposals(pending)
    if (pending[0]) {
      const target = list.find((entry) => entry.id === pending[0].entryId)
      if (target) {
        setSelected(target.id)
        const text = await window.api.readMemory(target.id)
        setOriginal(text)
        setDraft(text)
      }
    }
    setLoading(false)
    return list
  }, [])

  useEffect(() => {
    void load()
    // 목록은 처음 한 번만 읽는다 — 편집 중에 밑에서 바뀌면 곤란하다
  }, [load])

  useEffect(() => {
    if (!selected) return
    void window.api.memoryHistory(selected).then(setHistory)
  }, [selected, saved])

  async function open(e: MemoryEntry): Promise<void> {
    if (dirty && !confirm('저장하지 않은 변경이 있습니다. 버릴까요?')) return
    setSelected(e.id)
    setSaved(false)
    setPromotionOpen(false)
    setPromotionMessage(undefined)
    // 내용은 고른 것만 읽는다 — 자동 메모리는 100개가 넘을 수 있다
    const text = await window.api.readMemory(e.id)
    setOriginal(text)
    setDraft(text)
  }

  function openPromotion(): void {
    const globals = entries.filter((item) => item.scope === 'global')
    setPromotionTarget(globals[0]?.id ?? '')
    setPromotionText(draft)
    setPromotionMessage(undefined)
    setPromotionOpen(true)
  }

  async function promoteToGlobal(): Promise<void> {
    if (!entry || !promotionTarget || promotionBusy) return
    setPromotionBusy(true)
    setPromotionMessage(undefined)
    try {
      const result = await window.api.promoteMemoryToGlobal(
        entry.id,
        promotionTarget,
        promotionText,
      )
      if (!result.ok) {
        setPromotionMessage(result.message ?? '전역 Memory에 추가하지 못했습니다.')
        return
      }
      setEntries((items) =>
        items.map((item) =>
          item.id === promotionTarget ? { ...item, exists: true, updatedAt: Date.now() } : item,
        ),
      )
      setPromotionMessage(
        result.added === false ? '이미 같은 내용이 전역 Memory에 있습니다.' : '전역 Memory에 복사했습니다.',
      )
    } finally {
      setPromotionBusy(false)
    }
  }

  async function save(): Promise<void> {
    if (!entry || saving) return
    setSaving(true)
    try {
      await window.api.saveMemory(entry.id, draft)
      setOriginal(draft)
      setEntries((v) =>
        v.map((e) => (e.id === entry.id ? { ...e, exists: true, updatedAt: Date.now() } : e)),
      )
      setSaved(true)
      setTimeout(() => setSaved(false), 1600)
    } finally {
      setSaving(false)
    }
  }

  async function openProposal(proposal: MemoryProposal): Promise<void> {
    const target = entries.find((e) => e.id === proposal.entryId)
    if (target) await open(target)
  }

  async function decideProposal(proposal: MemoryProposal, approve: boolean): Promise<void> {
    if (approve && dirty) {
      setProposalError('직접 편집 중인 내용을 먼저 저장하거나 되돌린 뒤 승인하세요.')
      return
    }
    setProposalBusy(proposal.id)
    setProposalError(undefined)
    try {
      if (approve) {
        const ok = await window.api.approveMemoryProposal(proposal.id)
        if (!ok) {
          setProposalError('정본 파일에 제안을 적용하지 못했습니다. 경로와 파일 권한을 확인하세요.')
          return
        }
        if (proposal.entryId === selected) {
          const text = await window.api.readMemory(proposal.entryId)
          setOriginal(text)
          setDraft(text)
        }
      } else {
        await window.api.rejectMemoryProposal(proposal.id)
      }
      setProposals((items) => items.filter((item) => item.id !== proposal.id))
    } finally {
      setProposalBusy(undefined)
    }
  }

  return (
    <div className="grid h-full min-h-0 w-full grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)] overflow-hidden">
      {/* ── 목록 ─────────────────────────────── */}
      <div className="min-w-0 overflow-y-auto overflow-x-hidden border-r border-surface0 p-2.5">
        <h1 className="mb-3 px-1 text-[16px] font-semibold text-text">Memory</h1>

        {proposals.length > 0 && (
          <section className="mb-3 rounded-lg bg-mauve/10 p-1.5 ring-1 ring-mauve/20">
            <div className="flex items-center gap-1.5 px-1.5 py-1 text-[11px] font-medium text-mauve">
              <Sparkles className="h-3.5 w-3.5" /> AI 제안 {proposals.length}
            </div>
            <div className="px-1.5 pb-1 text-[10px] leading-relaxed text-overlay1">
              제안을 누르면 오른쪽에서 diff를 확인하고 승인하거나 거절할 수 있습니다.
            </div>
            {proposals.map((proposal) => (
              <button
                key={proposal.id}
                onClick={() => void openProposal(proposal)}
                className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[12px] text-subtext1 hover:bg-surface0/60 hover:text-text"
                title={proposal.reason}
              >
                {entries.find((e) => e.id === proposal.entryId)?.label ?? proposal.scope}
                <span className="ml-1 text-overlay1">· {proposal.reason}</span>
              </button>
            ))}
          </section>
        )}

        {loading && (
          <div className="flex items-center gap-2 px-1 text-[12px] text-overlay1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 불러오는 중
          </div>
        )}

        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-overlay0" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="이름으로 찾기"
            className="w-full rounded-md bg-base py-1.5 pl-7 pr-2 text-[12px] text-text outline-none ring-1 ring-transparent placeholder:text-overlay0 focus:ring-lavender/40"
          />
        </div>

        {SCOPES.map((scope) => {
          const items = visible.filter((e) => e.scope === scope.key)
          if (items.length === 0) return null
          // 자동 메모리는 작업 경로가 여럿이라 그 안에서 다시 묶는다
          const groups = [...new Set(items.map((e) => e.group ?? ''))]
          // 검색 중에는 접혀 있어도 결과를 보여준다 — 안 그러면 찾은 게 안 보인다
          const shut = !!closed[scope.key] && !q
          return (
            <section key={scope.key} className="mb-3">
              <button
                onClick={() => setClosed((c) => ({ ...c, [scope.key]: !c[scope.key] }))}
                title={scope.hint}
                className="mb-1 flex w-full items-center gap-1.5 rounded-md bg-surface0/70 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-subtext0 hover:bg-surface0 hover:text-text"
              >
                <scope.icon className="h-3.5 w-3.5" />
                {scope.label}
                <span className="ml-auto normal-case tracking-normal">{items.length}</span>
                {shut ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              {!shut &&
                groups.map((g) => (
                <div key={g}>
                  {g && (
                    <div
                      className="truncate px-2 pb-0.5 pt-1 text-[11px] text-overlay0"
                      title={g}
                      dir="rtl"
                    >
                      {g}
                    </div>
                  )}
                  {items
                    .filter((e) => (e.group ?? '') === g)
                    .map((e) => (
                <button
                  key={e.id}
                  onClick={() => void open(e)}
                  title={e.location}
                  className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] ${
                    e.id === selected
                      ? 'bg-surface0 text-text'
                      : 'text-subtext1 hover:bg-surface0/50'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{e.label}</span>
                  {!e.exists && <span className="shrink-0 text-[11px] text-overlay1">없음</span>}
                </button>
                    ))}
                  </div>
                ))}
            </section>
          )
        })}
      </div>

      {/* ── 편집 ─────────────────────────────── */}
      {entry ? (
        <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden p-4">
          <div className="mb-2 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-sapphire" />
                <span className="truncate text-[14px] font-medium text-text">{entry.label}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
                    entry.readBy === 'both'
                      ? 'bg-green/15 text-green'
                      : 'bg-surface0 text-subtext0'
                  }`}
                >
                  {entry.readBy === 'both' ? '모든 CLI' : 'Claude 전용'}
                </span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-overlay1" title={entry.location}>
                {entry.location}
              </div>
            </div>

            {entry.scope !== 'global' && (
              <button
                onClick={openPromotion}
                disabled={entries.every((item) => item.scope !== 'global')}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-sapphire/10 px-3 py-1.5 text-[12px] font-medium text-sapphire hover:bg-sapphire/20 disabled:opacity-40"
                title="선택한 내용을 전역 Memory에 복사"
              >
                <ArrowUpToLine className="h-3.5 w-3.5" /> 전역으로 승격
              </button>
            )}

            {saved ? (
              <span className="flex shrink-0 items-center gap-1 py-1.5 text-[12px] text-green">
                <Check className="h-3.5 w-3.5" /> 저장됨
              </span>
            ) : (
              <button
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="shrink-0 rounded-lg bg-lavender/20 px-3.5 py-1.5 text-[12px] font-medium text-lavender hover:bg-lavender/30 disabled:opacity-40"
              >
                저장
              </button>
            )}
          </div>

          {entry.note && (
            <div className="mb-2 flex items-start gap-1.5 rounded-lg bg-peach/10 px-3 py-2 text-[11px] leading-relaxed text-peach">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {entry.note}
            </div>
          )}

          {entry.scope === 'project' && (
            <div className="mb-2 rounded-lg bg-base px-3 py-2 text-[11px] leading-relaxed text-overlay1">
              <span className="text-subtext0">AGENTS.md</span> 에 저장합니다 — 도구를 가리지 않는
              이름이라 Codex 등 다른 CLI 도 같은 파일을 읽습니다. Claude 는{' '}
              <span className="font-mono text-subtext0">@AGENTS.md</span> 한 줄이 든 CLAUDE.md 로
              연결해 두며, 없으면 저장할 때 만들어 줍니다.
            </div>
          )}

          {!entry.exists && (
            <div className="mb-2 rounded-lg bg-base px-3 py-2 text-[11px] leading-relaxed text-overlay1">
              아직 파일이 없습니다. 저장하면 이 경로에 만들어집니다.
              {entry.scope === 'global' &&
                ' 전역 메모리는 실행 환경마다 파일이 따로입니다 — 다른 환경에는 적용되지 않습니다.'}
            </div>
          )}

          {proposals
            .filter((proposal) => proposal.entryId === entry.id)
            .map((proposal) => {
              return (
                <div key={proposal.id} className="mb-2 min-w-0 overflow-hidden rounded-lg bg-mauve/10 ring-1 ring-mauve/25">
                  <div className="flex items-start gap-2 px-3 py-2">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mauve" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-text">
                        <span>Memory 추가 제안</span>
                        <span className="rounded bg-mauve/15 px-1.5 py-0.5 text-[10px] font-normal text-mauve">
                          {proposal.scope === 'project' ? 'Project' : 'Agent'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-subtext0">{proposal.reason}</div>
                    </div>
                    <button
                      disabled={proposalBusy === proposal.id}
                      onClick={() => void decideProposal(proposal, false)}
                      className="rounded-md p-1 text-overlay1 hover:bg-surface0 hover:text-red disabled:opacity-40"
                      title="거절"
                    ><X className="h-3.5 w-3.5" /></button>
                    <button
                      disabled={proposalBusy === proposal.id}
                      onClick={() => void decideProposal(proposal, true)}
                      className="rounded-md bg-green/15 px-2.5 py-1 text-[11px] font-medium text-green hover:bg-green/25 disabled:opacity-40"
                    >승인해 추가</button>
                  </div>
                  <div className="mx-3 mb-2 min-w-0 rounded-md border border-surface1 bg-base px-3 py-2.5">
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-overlay1">
                      추가할 내용
                    </div>
                    <div className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-subtext1 overscroll-contain">
                      {proposal.content}
                    </div>
                  </div>
                  <div className="px-3 py-1.5 text-[10px] text-overlay1">
                    승인하면 위 내용만 기존 Memory 끝에 추가합니다. 승인 전에는 정본을 변경하지 않습니다.
                  </div>
                </div>
              )
            })}

          {proposalError && (
            <div className="mb-2 rounded-lg bg-red/10 px-3 py-2 text-[11px] text-red">
              {proposalError}
            </div>
          )}

          {promotionOpen && entry.scope !== 'global' && (
            <section className="mb-2 min-w-0 rounded-lg bg-sapphire/8 p-3 ring-1 ring-sapphire/20">
              <div className="mb-2 flex items-start gap-2">
                <ArrowUpToLine className="mt-0.5 h-4 w-4 shrink-0 text-sapphire" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-text">전역 Memory로 승격</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-overlay1">
                    원본은 그대로 두고 아래에서 고른 내용만 전역 정본 끝에 추가합니다.
                  </div>
                </div>
                <button
                  onClick={() => setPromotionOpen(false)}
                  className="rounded p-1 text-overlay1 hover:bg-surface0 hover:text-text"
                  title="닫기"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <label className="mb-2 block text-[11px] text-subtext0">
                대상 실행환경
                <select
                  value={promotionTarget}
                  onChange={(event) => {
                    setPromotionTarget(event.target.value)
                    setPromotionMessage(undefined)
                  }}
                  className="mt-1 block w-full rounded-md bg-mantle px-2.5 py-2 text-[12px] text-text outline-none ring-1 ring-surface1 focus:ring-sapphire/40"
                >
                  {entries.filter((item) => item.scope === 'global').map((item) => (
                    <option key={item.id} value={item.id}>{item.label} · {item.location}</option>
                  ))}
                </select>
              </label>

              <label className="block text-[11px] text-subtext0">
                추가할 내용
                <textarea
                  value={promotionText}
                  onChange={(event) => {
                    setPromotionText(event.target.value)
                    setPromotionMessage(undefined)
                  }}
                  spellCheck={false}
                  className="mt-1 min-h-32 w-full resize-y rounded-md bg-mantle p-2.5 font-mono text-[12px] leading-relaxed text-text outline-none ring-1 ring-surface1 focus:ring-sapphire/40"
                />
              </label>

              <div className="mt-2 flex items-center gap-2">
                {promotionMessage && (
                  <span className="min-w-0 flex-1 text-[11px] text-subtext0">{promotionMessage}</span>
                )}
                <button
                  onClick={() => void promoteToGlobal()}
                  disabled={!promotionTarget || !promotionText.trim() || promotionBusy}
                  className="ml-auto flex shrink-0 items-center gap-1 rounded-md bg-sapphire/20 px-3 py-1.5 text-[11px] font-medium text-sapphire hover:bg-sapphire/30 disabled:opacity-40"
                >
                  {promotionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpToLine className="h-3.5 w-3.5" />}
                  전역에 추가
                </button>
              </div>
            </section>
          )}

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 's' || e.key === 'Enter')) {
                e.preventDefault()
                void save()
              }
            }}
            spellCheck={false}
            placeholder="이 범위에서 늘 기억해야 할 것을 적습니다."
            className="min-h-48 min-w-0 flex-1 resize-none rounded-lg bg-mantle p-3 font-mono text-[13px] leading-relaxed text-text outline-none ring-1 ring-transparent placeholder:text-overlay0 focus:ring-lavender/40"
          />

          <div className="mt-2 flex items-center gap-3 text-[11px] text-overlay1">
            <span>{draft.length.toLocaleString()}자</span>
            {entry.updatedAt && <span>파일 수정 {when(entry.updatedAt)}</span>}
            {history.length > 0 && <span>앱에서 {history.length}번 변경 · 최근 {when(history[0].at)}</span>}
            <span className="ml-auto">Ctrl + S 또는 Ctrl + Enter로 저장</span>
          </div>
        </div>
      ) : (
        !loading && (
          <div className="flex flex-1 items-center justify-center text-[12px] text-overlay1">
            왼쪽에서 항목을 고르세요
          </div>
        )
      )}
    </div>
  )
}
