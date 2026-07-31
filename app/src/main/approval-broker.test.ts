import { describe, expect, it } from 'vitest'
import { assessRisk } from './approval-broker'

describe('assessRisk', () => {
  it('treats shell execution as high risk', () => {
    expect(assessRisk('Bash', { command: 'npm install' }, '/tmp/project')).toBe('high')
    expect(assessRisk('PowerShell', { command: 'npm install' }, '/tmp/project')).toBe('high')
  })

  it('allows writes inside the project as medium risk', () => {
    expect(assessRisk('Write', { file_path: '/tmp/project/src/a.ts' }, '/tmp/project')).toBe('med')
    expect(assessRisk('Edit', { file_path: 'src/a.ts' }, '/tmp/project')).toBe('med')
  })

  it('does not confuse sibling directories with project children', () => {
    expect(assessRisk('Write', { file_path: '/tmp/project-other/a.ts' }, '/tmp/project')).toBe('high')
  })
})
