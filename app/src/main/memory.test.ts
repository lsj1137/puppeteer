import { describe, expect, it, vi } from 'vitest'

// 경로 계산에 electron app 과 DB 가 필요하다. 순수 판단 함수만 볼 것이므로 막는다.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/userData' },
}))

const { cwdFromLogHead } = await import('./memory')

describe('cwdFromLogHead', () => {
  it('첫 줄의 작업 경로를 꺼낸다', () => {
    const head = '{"type":"user","cwd":"D:\\\\kccfw\\\\workspace_new_kerp","x":1}\n{"type":"a"}'
    expect(cwdFromLogHead(head)).toBe('D:\\kccfw\\workspace_new_kerp')
  })

  it('경로가 없으면 만들지 않는다', () => {
    expect(cwdFromLogHead('{"type":"summary"}')).toBeUndefined()
  })

  // 앞부분만 읽으므로 값 중간에서 잘릴 수 있다. 그때는 경로를 못 찾은 것으로 둔다.
  it('첫머리에서 잘려도 예외를 내지 않는다', () => {
    expect(cwdFromLogHead('{"cwd":"D:\\\\kccfw\\\\work')).toBeUndefined()
  })
})
