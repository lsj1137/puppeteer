/** 이 거리 안이면 «맨 아래를 보고 있다»로 본다. */
export const BOTTOM_THRESHOLD = 48

/** 복원을 다시 시도할 최대 횟수. 대화가 끝내 그만큼 길어지지 않으면 포기한다. */
export const SCROLL_RESTORE_ATTEMPTS = 12

export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** 새 응답을 따라갈지 판단한다. 요청한 위치가 아니라 실제 위치로 계산해야 한다. */
export function isFollowingBottom({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_THRESHOLD
}

/**
 * 저장해 둔 위치로 되돌릴 수 있는 상태인지.
 *
 * 승인하러 떠났다가 돌아오면 대화가 아직 다 그려지지 않았을 수 있다. 세션 이벤트는 비동기로
 * 복원되고 코드 블록 강조도 나중에 높이를 바꾼다. 그 시점에 `scrollTo` 를 부르면 브라우저가
 * 최대 스크롤로 잘라버리는데, 요청값 기준으로 «맨 아래»라고 판단해 버리면 이후 응답마다
 * 바닥으로 따라붙어 원래 위치를 영영 잃는다. 실제로 도달했을 때만 복원을 끝낸 것으로 본다.
 */
export function isScrollRestoreSatisfied(target: number, actual: number): boolean {
  // 소수점 배율(125% 등)에서 1px 오차가 난다.
  return Math.abs(actual - target) <= 1
}

/** 아직 도달하지 못했을 때 다시 시도할지. 무한 재시도는 «따라가기»를 영영 막는다. */
export function shouldRetryScrollRestore(satisfied: boolean, attemptsLeft: number): boolean {
  return !satisfied && attemptsLeft > 0
}
