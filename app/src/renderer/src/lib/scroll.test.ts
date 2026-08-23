import { describe, expect, it } from 'vitest'
import {
  BOTTOM_THRESHOLD,
  isFollowingBottom,
  isScrollRestoreSatisfied,
  SCROLL_RESTORE_ATTEMPTS,
  shouldRetryScrollRestore,
} from './scroll'

describe('isFollowingBottom', () => {
  it('하단 근처면 새 응답을 따라간다', () => {
    expect(isFollowingBottom({ scrollTop: 1000, scrollHeight: 1500, clientHeight: 500 })).toBe(true)
    expect(
      isFollowingBottom({ scrollTop: 1000 - BOTTOM_THRESHOLD, scrollHeight: 1500, clientHeight: 500 }),
    ).toBe(true)
  })

  it('위쪽을 읽는 중이면 따라가지 않는다', () => {
    expect(isFollowingBottom({ scrollTop: 200, scrollHeight: 1500, clientHeight: 500 })).toBe(false)
  })
})

describe('스크롤 복원', () => {
  // 승인하고 돌아왔을 때 대화가 아직 다 안 그려져 있으면 브라우저가 최대 스크롤로 자른다.
  // 요청값 기준으로 판단하면 «맨 아래»로 오인해, 이후 응답마다 바닥으로 따라붙는다.
  it('요청한 위치에 실제로 도달했을 때만 복원을 끝낸다', () => {
    expect(isScrollRestoreSatisfied(3000, 3000)).toBe(true)
    expect(isScrollRestoreSatisfied(3000, 800)).toBe(false)
  })

  // 배율이 125% 같은 값이면 1px 오차가 난다.
  it('1px 오차는 도달로 본다', () => {
    expect(isScrollRestoreSatisfied(3000, 2999)).toBe(true)
    expect(isScrollRestoreSatisfied(3000, 2998)).toBe(false)
  })

  it('도달하지 못했으면 다음 렌더에서 다시 시도한다', () => {
    expect(shouldRetryScrollRestore(false, SCROLL_RESTORE_ATTEMPTS)).toBe(true)
  })

  // 무한 재시도는 «바닥 따라가기»를 영영 막는다. 대화가 끝내 짧으면 포기해야 한다.
  it('횟수를 다 쓰면 포기한다', () => {
    expect(shouldRetryScrollRestore(false, 0)).toBe(false)
  })

  it('도달했으면 남은 횟수와 무관하게 끝낸다', () => {
    expect(shouldRetryScrollRestore(true, SCROLL_RESTORE_ATTEMPTS)).toBe(false)
  })
})
