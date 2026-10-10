import { describe, expect, it } from 'vitest'
import { isSlashCommand, matchSlashCommands, slashQuery } from './slash-command'

describe('isSlashCommand', () => {
  it('맨 앞의 명령만 인식한다', () => {
    expect(isSlashCommand('/context')).toBe(true)
    expect(isSlashCommand('/code-review high')).toBe(true)
    expect(isSlashCommand('  /anthropic-skills:pdf 요약')).toBe(true)
    expect(isSlashCommand('설명해줘 /context')).toBe(false)
  })

  // 절대 경로를 붙여 지시하는 일이 흔하다. 명령으로 잘못 보내면 앱 지침이 빠진다.
  it('경로는 명령으로 보지 않는다', () => {
    expect(isSlashCommand('/home/user/app 구조 봐줘')).toBe(false)
    expect(isSlashCommand('/')).toBe(false)
  })
})

describe('slashQuery', () => {
  it('첫 토큰을 치는 동안에만 값이 있다', () => {
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('/con')).toBe('con')
    expect(slashQuery('/context ')).toBeUndefined()
    expect(slashQuery('hello')).toBeUndefined()
  })
})

describe('matchSlashCommands', () => {
  it('앞부분 일치를 먼저 보이고 내부 명령은 뺀다', () => {
    const commands = ['review', 'code-review', 'compact', '__remote-workflow', 'review']
    expect(matchSlashCommands(commands, 're')).toEqual(['review', 'code-review'])
    expect(matchSlashCommands(commands, '')).toEqual(['review', 'code-review', 'compact'])
  })
})
