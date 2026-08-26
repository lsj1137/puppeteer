/** 창 비율에 따른 화면 배치. 가로는 3열, 세로는 1열 + 하단 시트다. */
export type LayoutMode = 'landscape' | 'portrait'

/** 설정에서 고를 수 있는 값. `auto` 는 창 비율을 따른다. */
export type LayoutPreference = 'auto' | LayoutMode

/**
 * 진입과 복귀 임계값을 다르게 둔다.
 *
 * 임계값이 하나뿐이면 높이와 너비가 비슷한 창을 드래그할 때 그 지점에서
 * 레이아웃이 매 프레임 뒤집힌다. 겹치지 않는 두 값 사이에서는 직전 배치를
 * 그대로 유지해 그 떨림을 없앤다.
 */
export const PORTRAIT_ENTER_RATIO = 1.05
export const PORTRAIT_EXIT_RATIO = 0.95

/**
 * 창 크기에서 자동 배치를 정한다.
 *
 * @param previous 직전 배치. 두 임계값 사이 구간에서 유지할 값이다.
 */
export function resolveLayoutMode(
  width: number,
  height: number,
  previous: LayoutMode = 'landscape',
): LayoutMode {
  // 최소화 등으로 0 이 들어오면 비율이 의미 없다. 직전 배치를 지킨다.
  if (!(width > 0) || !(height > 0)) return previous

  const ratio = height / width
  if (ratio >= PORTRAIT_ENTER_RATIO) return 'portrait'
  if (ratio <= PORTRAIT_EXIT_RATIO) return 'landscape'
  return previous
}

/** 사용자가 배치를 고정했으면 창 비율보다 그 선택이 우선한다. */
export function applyLayoutPreference(
  preference: LayoutPreference,
  automatic: LayoutMode,
): LayoutMode {
  return preference === 'auto' ? automatic : preference
}

/** 저장된 문자열이 아는 값일 때만 쓴다. 예전 버전이 남긴 값이 들어올 수 있다. */
export function parseLayoutPreference(value: string | null): LayoutPreference {
  return value === 'landscape' || value === 'portrait' || value === 'auto' ? value : 'auto'
}
