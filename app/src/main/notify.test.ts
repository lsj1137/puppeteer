import { describe, expect, it } from 'vitest'
import { macNotificationArgs } from './notify'

describe('macNotificationArgs', () => {
  it('passes title and body as osascript argv values', () => {
    const args = macNotificationArgs('승인 대기 · Bash', 'project — npm install')

    expect(args[0]).toBe('-e')
    expect(args[1]).toContain('display notification')
    expect(args.slice(2)).toEqual(['승인 대기 · Bash', 'project — npm install'])
  })

  it('does not interpolate notification text into the AppleScript source', () => {
    const title = 'title "with quotes"'
    const body = 'body with \\ slashes and "quotes"'
    const args = macNotificationArgs(title, body)

    expect(args[1]).not.toContain(title)
    expect(args[1]).not.toContain(body)
    expect(args.slice(2)).toEqual([title, body])
  })
})
