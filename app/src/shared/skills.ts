import type { SkillDef, SkillState } from './session'

/** 배열 순서가 곧 범위의 구체성이다. 뒤에 오는 정의가 같은 이름을 덮어쓴다. */
export function mergeSkillsBySpecificity(...layers: SkillDef[][]): SkillDef[] {
  const byName = new Map<string, SkillDef>()
  for (const layer of layers) for (const skill of layer) byName.set(skill.name, skill)
  return [...byName.values()]
}

export function applySkillStates(
  skills: SkillDef[],
  states?: Record<string, SkillState>,
): Array<SkillDef & { state: Exclude<SkillState, 'disabled'> }> {
  return skills.flatMap((skill) => {
    const state = states?.[skill.name] ?? 'available'
    return state === 'disabled' ? [] : [{ ...skill, state }]
  })
}
