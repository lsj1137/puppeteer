import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { exportFile, move, previewImport, save } from './skill-library'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Skill import preview', () => {
  it('preserves Markdown and reports unsupported frontmatter without saving', () => {
    const dir = mkdtempSync(join(tmpdir(), 'puppeteer-skill-import-'))
    dirs.push(dir)
    const path = join(dir, 'SKILL.md')
    writeFileSync(path, `---\nname: release-check\ndescription: 릴리스 전 검증\nlicense: MIT\nmetadata:\n  owner: team\n---\n\n# 절차\n\n- npm test\n`)

    expect(previewImport(path)).toMatchObject({
      sourceFormat: 'codex-skill',
      skill: { name: 'release-check', description: '릴리스 전 검증', content: '# 절차\n\n- npm test' },
      ignoredFrontmatter: ['license', 'metadata'],
    })
  })

  it.each([
    ['UTF-8 BOM', '\uFEFF---\nname: bom-skill\ndescription: BOM 파일\n---\n\n# 본문\n'],
    ['outer Markdown fence', '```markdown\n---\nname: fenced-skill\ndescription: 코드펜스 파일\n---\n\n# 본문\n```'],
  ])('accepts %s around valid frontmatter', (_label, source) => {
    const dir = mkdtempSync(join(tmpdir(), 'puppeteer-skill-import-'))
    dirs.push(dir)
    const path = join(dir, 'SKILL.md')
    writeFileSync(path, source)

    expect(previewImport(path).skill.content).toBe('# 본문')
  })
})

describe('Skill management', () => {
  it('moves a Skill to another scope without leaving the old canonical file', () => {
    const project = mkdtempSync(join(tmpdir(), 'puppeteer-skill-project-'))
    dirs.push(project)
    const name = `move-${Date.now()}`
    const global = save({
      id: '', name, description: 'move test', content: '# body', location: '', scope: 'global',
    })

    const moved = move(global, { ...global, scope: 'project', projectPath: project })

    expect(moved.scope).toBe('project')
    expect(moved.location).toContain(project)
    expect(() => readFileSync(global.location, 'utf8')).toThrow()
    expect(readFileSync(moved.location, 'utf8')).toContain('# body')
    rmSync(join(tmpdir(), 'skills', 'global', name), { recursive: true, force: true })
  })

  it('exports a canonical SKILL.md with frontmatter and body', () => {
    const dir = mkdtempSync(join(tmpdir(), 'puppeteer-skill-export-'))
    dirs.push(dir)
    const destination = join(dir, 'SKILL.md')

    exportFile({
      id: 'global:export-test', name: 'export-test', description: 'export description',
      content: '# exported', location: '', scope: 'global',
    }, destination)

    const output = readFileSync(destination, 'utf8')
    expect(output).toContain('name: export-test')
    expect(output).toContain('description: export description')
    expect(output).toContain('# exported')
  })

  it('does not overwrite a same-name Skill while moving scopes', () => {
    const project = mkdtempSync(join(tmpdir(), 'puppeteer-skill-collision-'))
    dirs.push(project)
    const name = `collision-${Date.now()}`
    const existing = save({
      id: '', name, description: 'existing', content: '# existing', location: '',
      scope: 'project', projectPath: project,
    })

    expect(() => save({
      ...existing, location: '', description: 'replacement', content: '# replacement',
    })).toThrow('이미 있습니다')
    expect(readFileSync(existing.location, 'utf8')).toContain('# existing')
  })
})
