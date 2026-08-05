import { describe, expect, it } from 'vitest'
import type { SkillDef, SkillScope } from '@shared/session'
import { applySkillStates, mergeSkillsBySpecificity } from '@shared/skills'

const skill = (name: string, scope: SkillScope): SkillDef => ({
  id: `${scope}:${name}`,
  name,
  description: '',
  content: scope,
  location: `/${scope}/${name}/SKILL.md`,
  scope,
})

describe('skill specificity', () => {
  it('prefers agent over project over global for the same name', () => {
    const result = mergeSkillsBySpecificity(
      [skill('shared', 'global'), skill('global-only', 'global')],
      [skill('shared', 'project')],
      [skill('shared', 'agent')],
    )
    expect(result.find((item) => item.name === 'shared')?.scope).toBe('agent')
    expect(result.find((item) => item.name === 'global-only')?.scope).toBe('global')
  })

  it('defaults to available and excludes disabled skills', () => {
    const result = applySkillStates(
      [skill('required-one', 'global'), skill('off', 'project'), skill('default', 'agent')],
      { 'required-one': 'required', off: 'disabled' },
    )
    expect(result.map(({ name, state }) => [name, state])).toEqual([
      ['required-one', 'required'],
      ['default', 'available'],
    ])
  })
})
