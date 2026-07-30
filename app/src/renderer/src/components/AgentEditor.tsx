import { useState } from 'react'
import { Trash2, X } from 'lucide-react'
import type { AgentDef } from '@shared/session'

const TEMPLATE = `이 에이전트가 맡을 역할과 작업 방식을 적습니다.

예시:
- 이 프로젝트의 리팩터링만 담당한다.
- 기능을 추가하거나 동작을 바꾸지 않는다.
- 변경 후 반드시 테스트를 실행하고 결과를 보고한다.`

export function emptyAgent(projectPath: string): AgentDef {
  return {
    name: '',
    description: '',
    instructions: TEMPLATE,
    projectPath,
    filePath: '',
    workspace: {},
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

/** Project Agent 편집. 저장하면 <project>/.claude/agents/<name>.md 로 기록된다. */
export default function AgentEditor({
  agent,
  isNew,
  onClose,
  onSaved,
  onDeleted,
}: {
  agent: AgentDef
  isNew: boolean
  onClose: () => void
  onSaved: (a: AgentDef) => void
  onDeleted: (name: string) => void
}) {
  const [draft, setDraft] = useState<AgentDef>(agent)
  const [allowed, setAllowed] = useState(list(agent.workspace.allowedTools))
  const [disallowed, setDisallowed] = useState(list(agent.workspace.disallowedTools))
  const [error, setError] = useState<string>()

  const set = <K extends keyof AgentDef>(k: K, v: AgentDef[K]): void =>
    setDraft((d) => ({ ...d, [k]: v }))

  async function save(): Promise<void> {
    const name = draft.name.trim()
    if (!/^[A-Za-z0-9가-힣_-]+$/.test(name)) {
      setError('이름은 파일명이 되므로 공백·특수문자 없이 지어주세요')
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
        allowedTools: parseList(allowed),
        disallowedTools: parseList(disallowed),
      },
    }
    await window.api.saveAgent(next)
    onSaved(next)
  }

  const Field = ({
    label,
    hint,
    children,
  }: {
    label: string
    hint?: string
    children: React.ReactNode
  }): React.ReactElement => (
    <label className="block">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[12px] font-medium text-subtext1">{label}</span>
        {hint && <span className="text-[11px] text-overlay1">{hint}</span>}
      </div>
      {children}
    </label>
  )

  const input =
    'w-full rounded-md border border-surface1 bg-base px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-overlay1 focus:border-lavender/60'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-crust/75 p-6">
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-surface1 bg-mantle">
        <div className="flex items-center gap-2 bg-surface0/40 px-4 py-2.5">
          <span className="flex-1 text-sm font-semibold text-text">
            {isNew ? '새 에이전트' : `에이전트 · ${agent.name}`}
          </span>
          {!isNew && (
            <button
              onClick={async () => {
                await window.api.deleteAgent(agent.projectPath, agent.name)
                onDeleted(agent.name)
              }}
              title="삭제"
              className="rounded p-1 text-overlay1 hover:bg-red/20 hover:text-red"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button onClick={onClose} className="rounded p-1 text-overlay1 hover:text-text">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="이름" hint="파일명이 됩니다">
              <input
                className={input}
                value={draft.name}
                disabled={!isNew}
                onChange={(e) => set('name', e.target.value)}
                placeholder="refactor-agent"
              />
            </Field>
            <Field label="모델" hint="비우면 기본값">
              <input
                className={input}
                value={draft.model ?? ''}
                onChange={(e) => set('model', e.target.value || undefined)}
                placeholder="opus / sonnet / haiku"
              />
            </Field>
          </div>

          <Field label="설명" hint="홈에서 지시를 라우팅할 때 이 문장을 봅니다">
            <input
              className={input}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="리팩터링 전담. 기능 변경 없이 구조만 정리한다."
            />
          </Field>

          <Field label="역할 지침" hint="세션의 시스템 프롬프트가 됩니다">
            <textarea
              className={`${input} min-h-[180px] leading-relaxed`}
              value={draft.instructions}
              onChange={(e) => set('instructions', e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="허용 도구" hint="쉼표 구분">
              <input
                className={input}
                value={allowed}
                onChange={(e) => setAllowed(e.target.value)}
                placeholder="Read, Edit, Bash(npm test)"
              />
            </Field>
            <Field label="금지 도구" hint="쉼표 구분">
              <input
                className={input}
                value={disallowed}
                onChange={(e) => setDisallowed(e.target.value)}
                placeholder="WebFetch, WebSearch"
              />
            </Field>
          </div>

          <Field label="완료 조건" hint="작업을 마칠 때 무엇을 보고할지">
            <input
              className={input}
              value={draft.workspace.completion ?? ''}
              onChange={(e) =>
                set('workspace', { ...draft.workspace, completion: e.target.value || undefined })
              }
              placeholder="테스트 통과 후 변경 요약 보고"
            />
          </Field>

          {error && (
            <div className="rounded-md bg-red/10 px-3 py-2 text-[12px] text-red">{error}</div>
          )}

          <div className="rounded-md bg-surface0/50 px-3 py-2 text-[11px] text-overlay1">
            저장 위치 · {draft.projectPath}\.claude\agents\{draft.name || '<이름>'}.md
            <br />
            앱 없이 <span className="font-mono text-subtext0">claude --agent {draft.name || '<이름>'}</span> 로도 동일하게 동작합니다.
          </div>
        </div>

        <div className="flex justify-end gap-2 bg-surface0/40 px-4 py-2.5">
          <button
            onClick={onClose}
            className="rounded-md border border-surface1 px-3 py-1.5 text-[12px] text-subtext1 hover:bg-surface0"
          >
            취소
          </button>
          <button
            onClick={() => void save()}
            className="rounded-md bg-lavender/20 px-3 py-1.5 text-[12px] font-medium text-lavender hover:bg-lavender/30"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
