import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@shared/session'
import { eventsAfterRestore } from './restore-merge'

const msg = (text: string): SessionEvent => ({ t: 'message', role: 'assistant', text }) as SessionEvent

describe('eventsAfterRestore', () => {
  it('keeps only events newer than the last stored one', () => {
    const live = [
      { eventId: 9, event: msg('already in db') },
      { eventId: 10, event: msg('also in db') },
      { eventId: 11, event: msg('arrived after the read') },
    ]
    expect(eventsAfterRestore(10, live)).toEqual([msg('arrived after the read')])
  })

  it('drops events without an id instead of risking duplicates', () => {
    expect(eventsAfterRestore(0, [{ event: msg('unknown') }])).toEqual([])
  })
})
