import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { previewImport } from './skill-library'

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
