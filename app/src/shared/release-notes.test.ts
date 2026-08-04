import { describe, expect, it } from 'vitest'
import { releaseNotesToText } from './release-notes'

describe('releaseNotesToText', () => {
  it('keeps plain release notes unchanged', () => {
    expect(releaseNotesToText('Fix updater\n\nImprove startup')).toBe(
      'Fix updater\n\nImprove startup',
    )
  })

  it('turns GitHub release HTML into readable text', () => {
    const html = [
      '<h2>What\'s Changed</h2>',
      '<ul><li>feat: add worktrees by <a href="https://github.com/user">@user</a> in <a href="https://github.com/repo/pull/1">#1</a></li></ul>',
      '<p><strong>Full Changelog</strong>: <a href="https://github.com/repo/commits/v1">https://github.com/repo/commits/v1</a></p>',
    ].join('')

    expect(releaseNotesToText(html)).toBe(
      "What's Changed\n\n- feat: add worktrees by @user in #1\n\nFull Changelog: https://github.com/repo/commits/v1",
    )
  })

  it('decodes common and numeric HTML entities', () => {
    expect(releaseNotesToText('<p>A &amp; B &#35;1 &#x1F680;</p>')).toBe('A & B #1 🚀')
  })
})
