import { useEffect, useMemo, useState } from 'react'
import { Bot, HelpCircle, Trash2, X } from 'lucide-react'
import type { AgentDef, ProviderId, SkillDef, SkillState, StoredProject } from '@shared/session'

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'claude-cli', label: 'Claude' },
  { id: 'codex-cli', label: 'Codex' },
]

const TEMPLATE = `이 에이전트가 맡을 역할과 작업 방식을 적습니다.

예시:
- 이 프로젝트의 리팩터링만 담당한다.
- 기능을 추가하거나 동작을 바꾸지 않는다.
- 변경 후 반드시 테스트를 실행하고 결과를 보고한다.`

/** 새 에이전트. 지금 보고 있는 프로젝트를 적용 대상 기본값으로 잡아준다. */
export function emptyAgent(projectPath?: string): AgentDef {
  return {
    name: '',
    description: '',
    instructions: TEMPLATE,
    filePath: '',
    scope: 'library',
    workspace: { projects: projectPath ? [projectPath] : undefined },
  }
}

const list = (v?: string[]): string => (v ?? []).join(', ')
const parseList = (v: string): string[] | undefined => {
  const arr = v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  return arr.length ? arr : undefined
}
const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** 라벨 옆 물음표. 설명은 평소엔 숨고 필요할 때만 나온다. */
function Hint({ text }: { text: string }): React.ReactElement {
  return (
    <span className="group/hint relative inline-flex align-middle">
      <button
        type="button"
        tabIndex={0}
        aria-label={text}
        className="text-overlay0 outline-none hover:text-subtext0 focus-visible:text-subtext0"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-10 ml-2 w-56 -translate-y-1/2 rounded-lg bg-crust px-2.5 py-1.5 text-[11px] leading-relaxed text-subtext1 opacity-0 shadow-lg ring-1 ring-surface1 transition-opacity duration-100 group-hover/hint:opacity-100 group-focus-within/hint:opacity-100 motion-reduce:transition-none"
      >
        {text}
      </span>
    </span>
  )
}

/** 에이전트 편집. 저장하면 앱 라이브러리에 기록된다. */
export default function AgentEditor({
  agent,
  isNew,
  projects,
  onClose,
  onSaved,
  onDeleted,
}: {
  agent: AgentDef
  isNew: boolean
  projects: StoredProject[]
  onClose: () => void
  onSaved: (a: AgentDef) => void
  onDeleted: (name: string) => void
}) {
  const [draft, setDraft] = useState<AgentDef>(agent)
  const [scope, setScope] = useState<string[]>(agent.workspace.projects ?? [])
  const [providers, setProviders] = useState<ProviderId[]>(agent.workspace.providers ?? [])
  const [allowed, setAllowed] = useState(list(agent.workspace.allowedTools))
  const [disallowed, setDisallowed] = useState(list(agent.workspace.disallowedTools))
  const [error, setError] = useState<string>()
  const [confirmDel, setConfirmDel] = useState(false)
  const [skills, setSkills] = useState<SkillDef[]>([])
  useEffect(() => { void window.api.listSkills().then(setSkills) }, [])
  const skillNames = useMemo(
    () => [
      ...new Set(
        skills
          .filter((skill) =>
            skill.scope === 'global' ||
            (skill.scope === 'agent' && skill.agentName === draft.name) ||
            (skill.scope === 'project' && (scope.length === 0 || scope.includes(skill.projectPath ?? ''))),
          )
          .map((skill) => skill.name),
      ),
    ].sort(),
    [draft.name, scope, skills],
  )

  const set = <K extends keyof AgentDef>(k: K, v: AgentDef[K]): void =>
    setDraft((d) => ({ ...d, [k]: v }))

  async function save(): Promise<void> {
    const name = draft.name.trim()
    if (!/^[A-Za-z0-9가-힣_-]+$/.test(name)) {
      setError('이름에 공백과 특수문자는 쓸 수 없습니다')
      return
    }
    if (!draft.instructions.trim()) {
      setError('역할 지침을 입력해주세요')
      return
    }
    const next: AgentDef = {
      ...draft,
      name,
      workspace: {
        ...draft.workspace,
        projects: scope.length ? scope : undefined,
        providers: providers.length ? providers : undefined,
        allowedTools: parseList(allowed),
        disallowedTools: parseList(disallowed),
        skills: draft.workspace.skills,
      },
    }
    await window.api.saveAgent(next)
    onSaved(next)
  }

  /** 라벨 | 컨트롤 2단. 라벨을 위에 쌓지 않아 세로가 훨씬 짧아진다. */
  const Row = ({
    label,
    hint,
    children,
  }: {
    label: string
    hint?: string
    children: React.ReactNode
  }): React.ReactElement => (
    <div className="grid grid-cols-[92px_1fr] items-start gap-x-4 py-2">
      <div className="flex items-center gap-1 pt-1.5 text-[12px] text-subtext0">
        <span>{label}</span>
        {hint && <Hint text={hint} />}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )

  const field =
    'w-full rounded-lg bg-base px-2.5 py-1.5 text-[13px] text-text outline-none ring-1 ring-transparent transition placeholder:text-overlay0 focus:ring-lavender/50 motion-reduce:transition-none'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-crust/60 p-6 backdrop-blur-[2px]"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
      }}
    >
      <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-mantle shadow-2xl ring-1 ring-surface0">
        {/* 이름이 곧 제목이다 — 별도 헤더 바를 두지 않는다 */}
        <div className="flex items-start gap-3 px-5 pb-1 pt-5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-mauve/15">
            <Bot className="h-4 w-4 text-mauve" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-overlay1">
              {isNew ? '새 에이전트' : '에이전트'}
            </div>
            {isNew ? (
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="refactor-agent"
                spellCheck={false}
                className="mt-0.5 w-full bg-transparent font-mono text-[17px] text-text outline-none placeholder:text-overlay0"
              />
            ) : (
              <div className="mt-0.5 truncate font-mono text-[17px] text-text">{agent.name}</div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {!isNew &&
              (confirmDel ? (
                <button
                  onClick={async () => {
                    await window.api.deleteAgent(agent.name)
                    onDeleted(agent.name)
                  }}
                  onBlur={() => setConfirmDel(false)}
                  autoFocus
                  className="rounded-md bg-red/15 px-2 py-1 text-[11px] font-medium text-red hover:bg-red/25"
                >
                  삭제할까요?
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDel(true)}
                  title="삭제"
                  className="rounded-md p-1.5 text-overlay1 hover:bg-red/15 hover:text-red"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ))}
            <button
              onClick={onClose}
              title="닫기"
              className="rounded-md p-1.5 text-overlay1 hover:bg-surface0 hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 pb-2 pt-2">
          <Row label="설명" hint="지시를 어느 에이전트로 보낼지 정할 때 이 문장을 보고 판단합니다.">
            <input
              className={field}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="리팩터링 전담. 기능 변경 없이 구조만 정리한다."
            />
          </Row>

          <Row label="역할 지침" hint="세션의 시스템 프롬프트가 됩니다. 이 에이전트가 무엇을 어떻게 하는지 적으세요.">
            <textarea
              className={`${field} min-h-[200px] resize-y leading-relaxed`}
              value={draft.instructions}
              onChange={(e) => set('instructions', e.target.value)}
            />
          </Row>

          <Row label="적용 대상" hint="고른 프로젝트에서만 이 에이전트가 보입니다. 아무것도 안 고르면 전체에서 쓸 수 있습니다.">
            {projects.length === 0 ? (
              <div className="py-1.5 text-[12px] text-overlay1">등록된 프로젝트가 없습니다</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {projects.map((p) => {
                  const on = scope.includes(p.path)
                  return (
                    <button
                      key={p.path}
                      type="button"
                      title={p.path}
                      onClick={() =>
                        setScope((v) => (on ? v.filter((x) => x !== p.path) : [...v, p.path]))
                      }
                      className={`rounded-md px-2 py-1 text-[12px] transition motion-reduce:transition-none ${
                        on
                          ? 'bg-mauve/20 text-mauve'
                          : 'bg-base text-overlay1 hover:text-subtext0'
                      }`}
                    >
                      {baseName(p.path)}
                    </button>
                  )
                })}
                {scope.length === 0 && (
                  <span className="self-center pl-1 text-[11px] text-overlay1">전체 프로젝트</span>
                )}
              </div>
            )}
          </Row>

          <Row
            label="실행 환경"
            hint="고른 환경에서만 실행됩니다. 내부 정보가 든 지침은 여기서 막아 두세요 — 지침 전문이 그대로 모델에 전달됩니다."
          >
            <div className="flex flex-wrap items-center gap-1">
              {PROVIDERS.map((p) => {
                const on = providers.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setProviders((v) => (on ? v.filter((x) => x !== p.id) : [...v, p.id]))
                    }
                    className={`rounded-md px-2 py-1 text-[12px] transition motion-reduce:transition-none ${
                      on ? 'bg-mauve/20 text-mauve' : 'bg-base text-overlay1 hover:text-subtext0'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}
              {providers.length === 0 && (
                <span className="pl-1 text-[11px] text-overlay1">제한 없음</span>
              )}
            </div>
          </Row>

          <Row label="모델" hint="비우면 앱 기본값을 씁니다. opus · sonnet · haiku 중 하나를 적으세요.">
            <input
              className={field}
              value={draft.model ?? ''}
              onChange={(e) => set('model', e.target.value || undefined)}
              placeholder="기본값"
              spellCheck={false}
            />
          </Row>

          <Row label="도구" hint="쉼표로 구분합니다. 허용을 지정하면 그것만 쓸 수 있고, 금지는 항상 막힙니다. 예: Bash(npm test)">
            <div className="grid grid-cols-2 gap-2">
              <input
                className={field}
                value={allowed}
                onChange={(e) => setAllowed(e.target.value)}
                placeholder="허용 — Read, Edit"
                spellCheck={false}
              />
              <input
                className={field}
                value={disallowed}
                onChange={(e) => setDisallowed(e.target.value)}
                placeholder="금지 — WebFetch"
                spellCheck={false}
              />
            </div>
          </Row>

          <Row label="Skills" hint="Required는 항상 적용, Available은 필요할 때 사용, Disabled는 같은 이름의 하위 Skill까지 끕니다.">
            {skillNames.length === 0 ? (
              <div className="py-1.5 text-[12px] text-overlay1">등록된 Skill이 없습니다</div>
            ) : (
              <div className="space-y-1">
                {skillNames.map((name) => {
                  const state = draft.workspace.skills?.[name] ?? 'available'
                  return (
                    <div key={name} className="flex items-center gap-2 rounded-md bg-base px-2 py-1">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-subtext0">{name}</span>
                      {(['required', 'available', 'disabled'] as SkillState[]).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => set('workspace', {
                            ...draft.workspace,
                            skills: { ...draft.workspace.skills, [name]: value },
                          })}
                          className={`rounded px-1.5 py-0.5 text-[10px] ${state === value ? 'bg-mauve/20 text-mauve' : 'text-overlay1 hover:text-subtext0'}`}
                        >{value}</button>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </Row>

          <Row label="완료 조건" hint="작업을 마칠 때 무엇을 보고할지 적습니다. 지침 끝에 덧붙여집니다.">
            <input
              className={field}
              value={draft.workspace.completion ?? ''}
              onChange={(e) =>
                set('workspace', { ...draft.workspace, completion: e.target.value || undefined })
              }
              placeholder="테스트 통과 후 변경 요약 보고"
            />
          </Row>
        </div>

        <div className="flex items-center gap-3 px-5 pb-5 pt-3">
          {error ? (
            <span className="flex-1 truncate text-[12px] text-red">{error}</span>
          ) : (
            <span className="flex-1 text-[11px] text-overlay1">
              앱이 보관합니다 · 내보내면 앱 없이도 쓸 수 있습니다
            </span>
          )}
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] text-subtext0 hover:bg-surface0 hover:text-text"
          >
            취소
          </button>
          <button
            onClick={() => void save()}
            className="rounded-lg bg-lavender/20 px-3.5 py-1.5 text-[12px] font-medium text-lavender hover:bg-lavender/30"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
