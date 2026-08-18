import { describe, expect, it } from 'vitest'
import { buildDelegateResultPrompt, extractDelegates } from './delegate'

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
