import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, FileCode2, Plus, Trash2 } from 'lucide-react'
import type { AgentDef, SkillDef, SkillScope, StoredProject } from '@shared/session'

const empty = (scope: SkillScope, projectPath?: string, agentName?: string): SkillDef => ({
  id: '',
  name: '',
  description: '',
  content: '',
  location: '',
  scope,
  projectPath,
  agentName,
})

export default function SkillsScreen({
  projects,
  agents,
}: {
  projects: StoredProject[]
  agents: AgentDef[]
}) {
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [selected, setSelected] = useState<SkillDef>()
  const [draft, setDraft] = useState<SkillDef>()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => setSkills(await window.api.listSkills()), [])
  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => [
    { key: 'global', label: 'Global', items: skills.filter((s) => s.scope === 'global') },
    ...projects.map((project) => ({
      key: `project:${project.path}`,
      label: `Project · ${project.path.split(/[\\/]/).pop()}`,
      items: skills.filter((s) => s.scope === 'project' && s.projectPath === project.path),
    })),
    ...agents.map((agent) => ({
      key: `agent:${agent.name}`,
      label: `Agent · ${agent.name}`,
      items: skills.filter((s) => s.scope === 'agent' && s.agentName === agent.name),
    })),
  ], [agents, projects, skills])

  function open(skill: SkillDef): void {
    setSelected(skill)
    setDraft({ ...skill })
    setError(undefined)
  }

  function create(scope: SkillScope, projectPath?: string, agentName?: string): void {
    const skill = empty(scope, projectPath, agentName)
    setSelected(undefined)
    setDraft(skill)
    setError(undefined)
  }

  async function save(): Promise<void> {
    if (!draft) return
    try {
      const next = await window.api.saveSkill(draft)
      setSelected(next)
      setDraft(next)
      await load()
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function remove(): Promise<void> {
    if (!selected || !confirm(`«${selected.name}» Skill을 삭제할까요?`)) return
    await window.api.deleteSkill(selected)
    setSelected(undefined)
    setDraft(undefined)
    await load()
  }

  const field = 'w-full rounded-lg bg-base px-3 py-2 text-[13px] text-text outline-none ring-1 ring-transparent focus:ring-lavender/40'
  const groupTone = (key: string): string => {
    if (key === 'global') return 'bg-sapphire/15 text-sapphire ring-sapphire/20'
    if (key.startsWith('project:')) return 'bg-green/15 text-green ring-green/20'
    return 'bg-mauve/15 text-mauve ring-mauve/20'
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 shrink-0 overflow-auto border-r border-surface0 p-3">
        <div className="mb-3">
          <h1 className="text-[16px] font-semibold text-text">Skills</h1>
          <p className="mt-1 text-[11px] leading-relaxed text-overlay1">Agent가 재사용하는 작업 절차입니다. 같은 이름은 Agent › Project › Global 순으로 우선합니다.</p>
        </div>
        {groups.map((group) => (
          <section key={group.key} className="mb-3">
            <div className={`mb-1 flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium ring-1 ${groupTone(group.key)}`}>
              <span className="min-w-0 flex-1 truncate">{group.label}</span>
              <button
                title={`${group.label} Skill 추가`}
                onClick={() => {
                  if (group.key === 'global') create('global')
                  else if (group.key.startsWith('project:')) create('project', group.key.slice(8))
                  else create('agent', undefined, group.key.slice(6))
                }}
                className="rounded p-1 text-current opacity-70 hover:bg-base/40 hover:opacity-100"
              ><Plus className="h-3.5 w-3.5" /></button>
            </div>
            {group.items.length === 0 ? (
              <div className="px-2 py-1 text-[11px] text-overlay0">없음</div>
            ) : group.items.map((skill) => (
              <button key={skill.id} onClick={() => open(skill)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] ${selected?.id === skill.id ? 'bg-surface0 text-text' : 'text-subtext1 hover:bg-surface0/50'}`}>
                <FileCode2 className="h-3.5 w-3.5 shrink-0 text-yellow" />
                <span className="truncate">{skill.name}</span>
              </button>
            ))}
          </section>
        ))}
      </aside>

      {draft ? (
        <main className="flex min-h-0 flex-1 flex-col gap-3 p-5">
          <div className="flex items-center gap-2">
            <span className="rounded bg-yellow/10 px-2 py-1 text-[11px] uppercase text-yellow">{draft.scope}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-overlay1">{draft.location || '저장하면 SKILL.md 정본이 생성됩니다'}</span>
            {selected && <button onClick={() => void remove()} className="rounded-md p-1.5 text-overlay1 hover:bg-red/10 hover:text-red" title="삭제"><Trash2 className="h-4 w-4" /></button>}
            {saved ? <span className="flex items-center gap-1 text-[12px] text-green"><Check className="h-3.5 w-3.5" /> 저장됨</span> : <button onClick={() => void save()} className="rounded-lg bg-lavender/20 px-3.5 py-1.5 text-[12px] font-medium text-lavender hover:bg-lavender/30">저장</button>}
          </div>
          <input value={draft.name} disabled={Boolean(selected)} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="skill-name" spellCheck={false} className={field} />
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="언제 이 Skill을 사용해야 하는지 한 문장으로 설명" className={field} />
          {error && <div className="rounded-lg bg-red/10 px-3 py-2 text-[12px] text-red">{error}</div>}
          <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="작업 절차, 확인 사항, 완료 조건을 Markdown으로 작성합니다." spellCheck={false} className="min-h-0 flex-1 resize-none rounded-lg bg-mantle p-3 font-mono text-[13px] leading-relaxed text-text outline-none ring-1 ring-transparent focus:ring-lavender/40" />
        </main>
      ) : (
        <main className="flex flex-1 items-center justify-center text-[12px] text-overlay1">왼쪽의 + 버튼으로 Skill을 만들거나 기존 Skill을 선택하세요.</main>
      )}
    </div>
  )
}
