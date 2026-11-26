/** 이 줄 수를 넘는 입력은 대화에서 접어 보여 준다. 긴 로그·코드를 붙여 넣으면 대화가 밀려난다. */
export const COLLAPSE_LINES = 50

/** 접었을 때 보여 줄 줄 수 */
export const PREVIEW_LINES = 12

/** 대화 찾기가 접힌 메시지 안에서 일치를 찾았을 때, 그 메시지를 펴 달라고 보내는 이벤트 */
export const REVEAL_EVENT = 'conversation-reveal'

/** 접힌 메시지에 붙는 표시. 찾기가 이걸 보고 `REVEAL_EVENT` 를 보낸다. */
export const COLLAPSED_ATTR = 'data-collapsed'

export function lineTotal(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length
}

export function isLongInput(text: string): boolean {
  return lineTotal(text) > COLLAPSE_LINES
}
