import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, FileUp, Link2, Loader2, X } from 'lucide-react'
import type { AgentDef, FetchedAgent, StoredProject } from '@shared/session'
import ConfirmDialog from './ConfirmDialog'

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** 지침에서 눈에 띄어야 할 것들. 읽기 전에 어디를 봐야 하는지 알려준다. */
const FLAGS: { re: RegExp; label: string }[] = [
  { re: /\b(rm\s+-rf|del\s+\/|format|mkfs)\b/i, label: '파일 삭제 명령' },
  { re: /\b(curl|wget|Invoke-WebRequest)\b/i, label: '외부 네트워크 호출' },
  { re: /\b(git\s+push|force-push|--force)\b/i, label: 'Git push' },
  { re: /(비밀번호|password|secret|token|api[_ -]?key)/i, label: '자격증명 언급' },
  { re: /\b(sudo|chmod\s+777)\b/i, label: '권한 상승' },
]

/**
 * 에이전트 가져오기.
 *
 * 남이 쓴 지침은 그 자체가 실행 지시다. 그래서 두 단계로 받는다.
 * ① 주소나 파일을 읽어 파싱만 하고, ② 전문과 요구 권한을 보여준 뒤
 * 사용자가 권한을 다시 켜야 저장된다. 요구한 권한을 기본값으로 켜주지 않는다.
 */
export default function AgentImport({
  projects,
  existingNames,
  onClose,
  onSaved,
}: {
  projects: StoredProject[]
  existingNames: string[]
  onClose: () => void
  onSaved: (a: AgentDef) => void
}) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [fetched, setFetched] = useState<FetchedAgent>()
  const [confirmClose, setConfirmClose] = useState(false)

  // ── 검토 단계에서 사용자가 다시 정하는 값 ──
  const [name, setName] = useState('')
  const [scope, setScope] = useState<string[]>([])
  const [tools, setTools] = useState<string[]>([])
  const [useModel, setUseModel] = useState(false)
  /** 원본과 연결해 두면 나중에 업데이트를 확인할 수 있다 */
  const [linked, setLinked] = useState(true)

  const collides = fetched && existingNames.includes(name) && name !== ''
  const flags = fetched
    ? FLAGS.filter((f) => f.re.test(fetched.agent.instructions)).map((f) => f.label)
    : []
  const dirty = Boolean(url.trim() || fetched)
  const requestClose = (): void => {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !confirmClose) requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function accept(f: FetchedAgent): void {
    setFetched(f)
    setName(f.agent.name)
    setScope([])
    setTools([]) // 요구한 권한은 켜주지 않는다 — 사용자가 직접 켠다
    setUseModel(false)
    setLinked(f.linkable)
    setError(undefined)
  }

  async function load(fn: () => Promise<FetchedAgent | undefined>): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      const f = await fn()
      if (f) accept(f)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function save(): Promise<void> {
    if (!fetched || !name.trim()) return
    const next: AgentDef = {
      ...fetched.agent,
      name: name.trim(),
      model: useModel ? fetched.requested.model : undefined,
      workspace: {
        ...fetched.agent.workspace,
        projects: scope.length ? scope : undefined,
        allowedTools: tools.length ? tools : undefined,
        source:
          linked && fetched.linkable
            ? { url: fetched.source, hash: fetched.hash, checkedAt: Date.now() }
            : undefined,
      },
    }
    await window.api.saveAgent(next)
    onSaved(next)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-crust/60 p-6 backdrop-blur-[2px]">
      <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-mantle shadow-2xl ring-1 ring-surface0">
        <div className="flex items-start gap-3 px-5 pb-1 pt-5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-mauve/15">
            <Bot className="h-4 w-4 text-mauve" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-overlay1">
              {fetched ? '가져오기 검토' : '에이전트 가져오기'}
            </div>
            <div className="mt-0.5 truncate font-mono text-[17px] text-text">
              {fetched ? fetched.agent.name : '주소 또는 파일'}
            </div>
          </div>
          <button
            onClick={requestClose}
            className="rounded-md p-1.5 text-overlay1 hover:bg-surface0 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 pb-2 pt-3">
          {!fetched ? (
            <>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && url.trim()) {
                      void load(() => window.api.fetchAgentFromUrl(url.trim()))
                    }
                  }}
                  placeholder="https://github.com/owner/repo/blob/main/agent.md"
                  spellCheck={false}
                  className="w-full flex-1 rounded-lg bg-base px-2.5 py-1.5 text-[13px] text-text outline-none ring-1 ring-transparent placeholder:text-overlay0 focus:ring-lavender/50"
                />
                <button
                  disabled={!url.trim() || busy}
                  onClick={() => void load(() => window.api.fetchAgentFromUrl(url.trim()))}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-lavender/20 px-3 py-1.5 text-[12px] font-medium text-lavender hover:bg-lavender/30 disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                  불러오기
                </button>
              </div>

              <button
                onClick={() => void load(() => window.api.fetchAgentFromFile())}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-base py-2 text-[12px] text-subtext0 hover:text-text"
              >
                <FileUp className="h-3.5 w-3.5" /> 파일에서 가져오기
              </button>

              <p className="text-[11px] leading-relaxed text-overlay1">
                GitHub·GitLab 의 브라우저 주소를 그대로 붙여도 됩니다. raw 주소로 바꿔 읽습니다.
              </p>
              {error && (
                <div className="rounded-lg bg-red/10 px-3 py-2 text-[12px] leading-relaxed text-red">
                  {error}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="truncate text-[11px] text-overlay1" title={fetched.source}>
                출처 · {fetched.source}
              </div>

              {flags.length > 0 && (
                <div className="rounded-lg bg-peach/10 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-peach">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    지침에 이런 내용이 있습니다
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-subtext0">
                    {flags.join(' · ')} — 아래 전문에서 직접 확인하세요.
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1 text-[12px] text-subtext0">지침 전문</div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-base p-3 font-mono text-[12px] leading-relaxed text-subtext1">
                  {fetched.agent.instructions}
                </pre>
              </div>

              <div>
                <div className="mb-1 text-[12px] text-subtext0">
                  이 에이전트가 요구한 권한
                  <span className="ml-1.5 text-[11px] text-overlay1">
                    켜지 않았습니다. 필요한 것만 직접 켜세요.
                  </span>
                </div>
                {fetched.requested.allowedTools.length === 0 && !fetched.requested.model ? (
                  <div className="rounded-lg bg-base px-3 py-2 text-[12px] text-overlay1">
                    요구한 권한이 없습니다.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {fetched.requested.allowedTools.map((t) => {
                      const on = tools.includes(t)
                      return (
                        <button
                          key={t}
                          onClick={() =>
                            setTools((v) => (on ? v.filter((x) => x !== t) : [...v, t]))
                          }
                          className={`rounded-md px-2 py-1 font-mono text-[12px] ${
                            on ? 'bg-peach/20 text-peach' : 'bg-base text-overlay1 hover:text-subtext0'
                          }`}
                        >
                          {t}
                        </button>
                      )
                    })}
                    {fetched.requested.model && (
                      <button
                        onClick={() => setUseModel((v) => !v)}
                        className={`rounded-md px-2 py-1 text-[12px] ${
                          useModel
                            ? 'bg-mauve/20 text-mauve'
                            : 'bg-base text-overlay1 hover:text-subtext0'
                        }`}
                      >
                        모델 {fetched.requested.model}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1 text-[12px] text-subtext0">
                  적용 대상
                  <span className="ml-1.5 text-[11px] text-overlay1">
                    안 고르면 전체 프로젝트
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {projects.map((p) => {
                    const on = scope.includes(p.path)
                    return (
                      <button
                        key={p.path}
                        title={p.path}
                        onClick={() =>
                          setScope((v) => (on ? v.filter((x) => x !== p.path) : [...v, p.path]))
                        }
                        className={`rounded-md px-2 py-1 text-[12px] ${
                          on ? 'bg-mauve/20 text-mauve' : 'bg-base text-overlay1 hover:text-subtext0'
                        }`}
                      >
                        {p.alias || baseName(p.path)}
                      </button>
                    )
                  })}
                </div>
              </div>

              {fetched.linkable && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-base px-3 py-2">
                  <input
                    type="checkbox"
                    checked={linked}
                    onChange={(e) => setLinked(e.target.checked)}
                    className="mt-0.5 accent-mauve"
                  />
                  <span className="text-[12px] leading-relaxed text-subtext0">
                    원본과 연결해 두기
                    <span className="ml-1.5 text-[11px] text-overlay1">
                      나중에 원본이 바뀌면 확인해서 골라 반영할 수 있습니다. 자동으로 바뀌지는 않습니다.
                    </span>
                  </span>
                </label>
              )}

              <div>
                <div className="mb-1 text-[12px] text-subtext0">이름</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  spellCheck={false}
                  className="w-full rounded-lg bg-base px-2.5 py-1.5 font-mono text-[13px] text-text outline-none ring-1 ring-transparent focus:ring-lavender/50"
                />
                {collides && (
                  <div className="mt-1 text-[11px] text-peach">
                    같은 이름이 이미 있습니다. 저장하면 덮어씁니다.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {fetched && (
          <div className="flex items-center gap-3 px-5 pb-5 pt-3">
            <span className="flex-1 text-[11px] text-overlay1">
              지침을 읽고 권한을 정한 뒤 추가하세요
            </span>
            <button
              onClick={() => setFetched(undefined)}
              className="rounded-lg px-3 py-1.5 text-[12px] text-subtext0 hover:bg-surface0 hover:text-text"
            >
              뒤로
            </button>
            <button
              disabled={!name.trim()}
              onClick={() => void save()}
              className="rounded-lg bg-lavender/20 px-3.5 py-1.5 text-[12px] font-medium text-lavender hover:bg-lavender/30 disabled:opacity-40"
            >
              추가
            </button>
          </div>
        )}
      </div>
      {confirmClose && (
        <ConfirmDialog
          title="가져오기를 닫을까요?"
          description="검토 중인 Agent와 선택한 설정이 사라집니다."
          confirmLabel="가져오기 닫기"
          tone="danger"
          onCancel={() => setConfirmClose(false)}
          onConfirm={onClose}
        />
      )}
    </div>
  )
}
