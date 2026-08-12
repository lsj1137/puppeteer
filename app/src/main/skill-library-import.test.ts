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
})
