import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Download, FileCode2, FileInput, Plus, Trash2, X } from 'lucide-react'
import type { AgentDef, SkillDef, SkillImportPreview, SkillScope, StoredProject } from '@shared/session'

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
  const [importPreview, setImportPreview] = useState<SkillImportPreview>()
  const [importScope, setImportScope] = useState<SkillScope>('global')
  const [importProject, setImportProject] = useState('')
  const [importAgent, setImportAgent] = useState('')

  const load = useCallback(async () => setSkills(await window.api.listSkills()), [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!draft || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

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
      const moved = Boolean(selected) && (
        selected.scope !== draft.scope
        || selected.projectPath !== draft.projectPath
        || selected.agentName !== draft.agentName
      )
      const next = moved && selected
        ? await window.api.moveSkill(selected, draft)
        : await window.api.saveSkill(draft)
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
    try {
      await window.api.deleteSkill(selected)
      setSelected(undefined)
      setDraft(undefined)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function exportSelected(): Promise<void> {
    if (!selected) return
    try {
      await window.api.exportSkill(selected)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function changeScope(scope: SkillScope): void {
    if (!draft) return
    setDraft({
      ...draft,
      scope,
      projectPath: scope === 'project' ? (draft.projectPath || projects[0]?.path) : undefined,
      agentName: scope === 'agent' ? (draft.agentName || agents[0]?.name) : undefined,
    })
  }

  async function pickImport(): Promise<void> {
    try {
      const preview = await window.api.importSkillFromFile()
      if (!preview) return
      setImportPreview(preview)
      setImportScope('global')
      setImportProject(projects[0]?.path ?? '')
      setImportAgent(agents[0]?.name ?? '')
      setError(undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function reviewImport(): void {
    if (!importPreview) return
    const projectPath = importScope === 'project' ? importProject : undefined
    const agentName = importScope === 'agent' ? importAgent : undefined
    setSelected(undefined)
    setDraft({
      ...empty(importScope, projectPath, agentName),
      ...importPreview.skill,
    })
    setImportPreview(undefined)
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
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 text-[16px] font-semibold text-text">Skills</h1>
            <button onClick={() => void pickImport()} title="SKILL.md 가져오기" className="rounded-md p-1.5 text-overlay1 hover:bg-surface0 hover:text-text">
              <FileInput className="h-4 w-4" />
            </button>
          </div>
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
            {selected && <button onClick={() => void exportSelected()} className="rounded-md p-1.5 text-overlay1 hover:bg-surface0 hover:text-text" title="SKILL.md 내보내기"><Download className="h-4 w-4" /></button>}
            {selected && <button onClick={() => void remove()} className="rounded-md p-1.5 text-overlay1 hover:bg-red/10 hover:text-red" title="삭제"><Trash2 className="h-4 w-4" /></button>}
            {saved ? <span className="flex items-center gap-1 text-[12px] text-green"><Check className="h-3.5 w-3.5" /> 저장됨</span> : <button onClick={() => void save()} className="rounded-lg bg-lavender/20 px-3.5 py-1.5 text-[12px] font-medium text-lavender hover:bg-lavender/30">저장</button>}
          </div>
          <input value={draft.name} disabled={Boolean(selected)} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="skill-name" spellCheck={false} className={field} />
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="언제 이 Skill을 사용해야 하는지 한 문장으로 설명" className={field} />
          <div className="grid grid-cols-2 gap-2">
            <select value={draft.scope} onChange={(e) => changeScope(e.target.value as SkillScope)} className={field}>
              <option value="global">Global · 모든 프로젝트</option>
              <option value="project" disabled={projects.length === 0}>Project · 특정 프로젝트</option>
              <option value="agent" disabled={agents.length === 0}>Agent · 특정 에이전트</option>
            </select>
            {draft.scope === 'project' ? (
              <select value={draft.projectPath ?? ''} onChange={(e) => setDraft({ ...draft, projectPath: e.target.value })} className={field}>
                {projects.map((project) => <option key={project.path} value={project.path}>{project.alias || project.path}</option>)}
              </select>
            ) : draft.scope === 'agent' ? (
              <select value={draft.agentName ?? ''} onChange={(e) => setDraft({ ...draft, agentName: e.target.value })} className={field}>
                {agents.map((agent) => <option key={agent.name} value={agent.name}>{agent.name}</option>)}
              </select>
            ) : <div className="flex items-center px-3 text-[11px] text-overlay1">모든 프로젝트와 Agent에서 사용할 수 있습니다.</div>}
          </div>
          {error && <div className="rounded-lg bg-red/10 px-3 py-2 text-[12px] text-red">{error}</div>}
          <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="작업 절차, 확인 사항, 완료 조건을 Markdown으로 작성합니다." spellCheck={false} className="min-h-0 flex-1 resize-none rounded-lg bg-mantle p-3 font-mono text-[13px] leading-relaxed text-text outline-none ring-1 ring-transparent focus:ring-lavender/40" />
        </main>
      ) : (
        <main className="flex flex-1 items-center justify-center text-[12px] text-overlay1">왼쪽의 + 버튼으로 Skill을 만들거나 기존 Skill을 선택하세요.</main>
      )}

      {importPreview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-crust/70 p-6 backdrop-blur-[2px]">
          <section className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-mantle shadow-2xl ring-1 ring-surface1">
            <header className="flex items-start gap-3 border-b border-surface0 px-5 py-4">
              <FileInput className="mt-0.5 h-5 w-5 shrink-0 text-yellow" />
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-text">Skill 가져오기 검토</h2>
                <p className="mt-1 truncate font-mono text-[10px] text-overlay1">{importPreview.sourcePath}</p>
              </div>
              <button onClick={() => setImportPreview(undefined)} title="닫기" className="rounded p-1 text-overlay1 hover:bg-surface0 hover:text-text"><X className="h-4 w-4" /></button>
            </header>
            <div className="min-h-0 space-y-3 overflow-y-auto p-5 text-[12px]">
              <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 rounded-lg bg-base p-3">
                <span className="text-overlay1">원본 형식</span>
                <span className="text-text">{importPreview.sourceFormat === 'codex-skill' ? 'Codex SKILL.md' : '공통 SKILL.md'}</span>
                <span className="text-overlay1">이름</span><span className="font-mono text-text">{importPreview.skill.name}</span>
                <span className="text-overlay1">설명</span><span className="text-subtext1">{importPreview.skill.description || '없음'}</span>
                <span className="text-overlay1">본문</span><span className="text-subtext1">Markdown {importPreview.skill.content.length.toLocaleString()}자 · 그대로 보존</span>
              </div>

              {importPreview.ignoredFrontmatter.length > 0 && (
                <div className="rounded-lg bg-yellow/10 px-3 py-2 text-[11px] leading-relaxed text-yellow">
                  Puppeteer 정본에서 사용하지 않는 frontmatter: {importPreview.ignoredFrontmatter.join(', ')}. 원본 파일은 수정하지 않습니다.
                </div>
              )}

              <label className="block text-[11px] text-subtext0">저장 범위
                <select value={importScope} onChange={(e) => setImportScope(e.target.value as SkillScope)} className="mt-1 w-full rounded-md bg-base px-3 py-2 text-[12px] text-text outline-none ring-1 ring-surface1">
                  <option value="global">Global · 모든 프로젝트</option>
                  <option value="project" disabled={projects.length === 0}>Project · 특정 프로젝트</option>
                  <option value="agent" disabled={agents.length === 0}>Agent · 특정 에이전트</option>
                </select>
              </label>
              {importScope === 'project' && <select value={importProject} onChange={(e) => setImportProject(e.target.value)} className="w-full rounded-md bg-base px-3 py-2 text-[12px] text-text outline-none ring-1 ring-surface1">{projects.map((p) => <option key={p.path} value={p.path}>{p.alias || p.path}</option>)}</select>}
              {importScope === 'agent' && <select value={importAgent} onChange={(e) => setImportAgent(e.target.value)} className="w-full rounded-md bg-base px-3 py-2 text-[12px] text-text outline-none ring-1 ring-surface1">{agents.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}</select>}
              <div className="rounded-lg bg-sapphire/8 px-3 py-2 text-[11px] leading-relaxed text-subtext0">
                다음 단계에서 이름·설명·본문을 다시 편집한 뒤 저장합니다. 가져오기만으로 파일을 만들거나 기존 Skill을 덮어쓰지 않습니다.
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-surface0 px-5 py-3">
              <button onClick={() => setImportPreview(undefined)} className="rounded-md px-3 py-1.5 text-[12px] text-overlay1 hover:bg-surface0">취소</button>
              <button onClick={reviewImport} disabled={(importScope === 'project' && !importProject) || (importScope === 'agent' && !importAgent)} className="rounded-md bg-lavender/20 px-3 py-1.5 text-[12px] font-medium text-lavender hover:bg-lavender/30 disabled:opacity-40">편집기로 가져오기</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}
