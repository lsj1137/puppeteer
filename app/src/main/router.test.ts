import { describe, expect, it, vi } from 'vitest'

// router 는 db·agent-library 를 거쳐 electron 을 끌어온다. 출력 해석만 볼 것이므로 막는다.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/userData' },
}))

const { claudeResult, lastCodexMessage } = await import('./router')

describe('claudeResult', () => {
  it('`--output-format json` 봉투에서 결과만 꺼낸다', () => {
    expect(claudeResult(JSON.stringify({ result: '{"index":2,"reason":"조사"}' }))).toBe(
      '{"index":2,"reason":"조사"}',
    )
  })

  it('봉투가 아니면 원문을 그대로 둔다 — 상위에서 해석 실패로 드러난다', () => {
    expect(claudeResult('not json')).toBe('not json')
  })
})

describe('lastCodexMessage', () => {
  // codex exec --json 은 JSONL 을 흘린다. 중간 이벤트가 아니라 마지막 응답을 써야 한다.
  it('마지막 agent_message 를 고른다', () => {
    const out = [
      '{"type":"item.started","item":{"id":"1","type":"reasoning"}}',
      '{"type":"item.completed","item":{"id":"2","type":"agent_message","text":"먼저 생각"}}',
      '{"type":"item.completed","item":{"id":"3","type":"agent_message","text":"{\\"index\\":1}"}}',
    ].join('\n')

    expect(lastCodexMessage(out)).toBe('{"index":1}')
  })

  it('도구 이벤트만 있으면 원문을 돌려준다', () => {
    const out = '{"type":"item.started","item":{"id":"1","type":"command_execution"}}'
    expect(lastCodexMessage(out)).toBe(out)
  })

  it('깨진 줄이 섞여도 멈추지 않는다', () => {
    const out = [
      '{"type":"item.completed"',
      'plain log line',
      '{"type":"item.completed","item":{"id":"9","type":"agent_message","text":"ok"}}',
    ].join('\n')

    expect(lastCodexMessage(out)).toBe('ok')
  })
})
