import { describe, expect, it } from 'vitest'
import {
  buildDelegateResultPrompt,
  extractDelegates,
  MAX_SUB_RUNS,
  shouldDropPendingDelegations,
  shouldHoldForDelegation,
} from './delegate'

describe('extractDelegates', () => {
  it('블록을 걷어내고 위임만 남긴다', () => {
    const { text, delegates } = extractDelegates(
      '문서를 훑어보라고 맡겼습니다.\n```delegate\n{"runs":[{"agent":"explorer","task":"docs 훑기"}]}\n```',
    )

    expect(text).toBe('문서를 훑어보라고 맡겼습니다.')
    expect(delegates).toEqual([{ agent: 'explorer', task: 'docs 훑기' }])
  })

  it('agent 를 생략하면 역할 정본 없이 도는 보조가 된다', () => {
    const { delegates } = extractDelegates('```delegate\n{"runs":[{"task":"로그 확인"}]}\n```')
    expect(delegates).toEqual([{ agent: undefined, task: '로그 확인' }])
  })

  // 잘못된 신호를 조용히 삼키면 사용자는 위임이 된 줄 안다. 원문을 남겨 눈에 보이게 한다.
  it('깨진 JSON 은 일반 텍스트로 남긴다', () => {
    const source = '```delegate\n{"runs":[{"task":\n```'
    expect(extractDelegates(source)).toEqual({ text: source, delegates: [] })
  })

  it('task 가 없는 항목만 있으면 위임으로 보지 않는다', () => {
    const source = '```delegate\n{"runs":[{"agent":"explorer"}]}\n```'
    const { text, delegates } = extractDelegates(source)
    expect(delegates).toEqual([])
    expect(text).toBe(source)
  })

  it('위임이 없으면 본문을 그대로 둔다', () => {
    expect(extractDelegates('그냥 답변')).toEqual({ text: '그냥 답변', delegates: [] })
  })

  // 자르는 일은 실행부가 하고 알림도 남긴다. 파서는 요청 전부를 그대로 넘긴다.
  it('상한을 넘는 요청도 파서는 전부 돌려준다', () => {
    const runs = Array.from({ length: MAX_SUB_RUNS + 2 }, (_, index) => ({ task: `조사 ${index}` }))
    const { delegates } = extractDelegates(`\`\`\`delegate\n${JSON.stringify({ runs })}\n\`\`\``)
    expect(delegates).toHaveLength(MAX_SUB_RUNS + 2)
  })
})

describe('buildDelegateResultPrompt', () => {
  it('사용자가 쓴 것이 아님을 밝히고 성공·실패를 함께 전달한다', () => {
    const prompt = buildDelegateResultPrompt([
      { agent: 'explorer', task: 'docs 훑기', ok: true, summary: 'README 확인' },
      { task: '로그 확인', ok: false, summary: '시간 초과' },
    ])

    expect(prompt).toContain('사용자가 쓴 것이 아닙니다')
    expect(prompt).toContain('보조 1 (explorer) 완료')
    expect(prompt).toContain('README 확인')
    expect(prompt).toContain('보조 2 실패')
    expect(prompt).toContain('시간 초과')
  })

  it('빈 결과도 비어 있다고 알린다', () => {
    const prompt = buildDelegateResultPrompt([{ task: '조사', ok: true, summary: '   ' }])
    expect(prompt).toContain('(반환된 내용 없음)')
  })
})

describe('위임 대기 중 세션 유지', () => {
  it('위임이 남아 있으면 Lead 가 끝나도 세션을 붙잡는다', () => {
    expect(shouldHoldForDelegation('completed', true, true)).toBe(true)
  })

  it('위임이 없으면 평소대로 종료한다', () => {
    expect(shouldHoldForDelegation('completed', true, false)).toBe(false)
  })

  // 보조 run 의 종료가 세션을 붙잡거나 끝내면 안 된다. 판단은 Lead 만 한다.
  it('보조 run 의 종료는 판단에 쓰지 않는다', () => {
    expect(shouldHoldForDelegation('completed', false, true)).toBe(false)
  })

  it('실패·중지로 끝나면 붙잡지 않고 대기 위임을 버린다', () => {
    expect(shouldHoldForDelegation('failed', true, true)).toBe(false)
    expect(shouldDropPendingDelegations('failed', true)).toBe(true)
    expect(shouldDropPendingDelegations('stopped', true)).toBe(true)
  })

  it('정상 완료면 대기 위임을 버리지 않는다', () => {
    expect(shouldDropPendingDelegations('completed', true)).toBe(false)
  })

  it('보조 run 의 실패로 대기 위임을 버리지 않는다', () => {
    expect(shouldDropPendingDelegations('failed', false)).toBe(false)
  })
})
