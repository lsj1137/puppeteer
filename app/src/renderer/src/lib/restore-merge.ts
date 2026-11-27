import type { SessionEvent } from '@shared/session'

export interface LiveEvent {
  eventId?: number
  event: SessionEvent
}

/**
 * DB 복원과 실시간 수신을 잇는다.
 *
 * 복원은 DB 를 읽는 동안에도 이벤트가 계속 온다(실행 중인 세션을 새로고침한 경우).
 * DB 에 이미 담긴 이벤트(id ≤ 마지막 DB id)는 버리고, 그 뒤에 온 것만 이어 붙인다.
 * id 를 모르는 이벤트는 겹치는지 알 수 없으니 버린다 — 중복으로 그리는 쪽이 더 헷갈린다.
 */
export function eventsAfterRestore(lastStoredId: number, live: LiveEvent[]): SessionEvent[] {
  return live
    .filter(({ eventId }) => eventId !== undefined && eventId > lastStoredId)
    .map(({ event }) => event)
}
