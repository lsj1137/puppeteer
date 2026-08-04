import { describe, expect, it } from 'vitest'
import type { StoredSession } from '@shared/session'
import {
  EMPTY_SESSION_VIEW,
  reduceSessionView,
  splitSessionTabs,
} from './session-view'

const session = (id: string): StoredSession => ({
  id,
  projectPath: 'C:\\repo',
  cliSessionId: null,
  runnerId: null,
  title: id,
  status: 'completed',
  costUsd: 0,
  startedAt: 0,
  endedAt: null,
})

describe('reduceSessionView', () => {
  it('builds assistant entries and fenced-code artifacts through the shared reducer', () => {
    const code = Array.from({ length: 6 }, (_, index) => `const value${index} = ${index}`).join('\n')
    const view = reduceSessionView(
      EMPTY_SESSION_VIEW,
      {
        t: 'message',
        role: 'assistant',
        messageId: 'message-1',
        text: `설명\n\`\`\`ts\n${code}\n\`\`\``,
      },
      'event-1',
    )

    expect(view.entries).toHaveLength(1)
    expect(view.entries[0]).toMatchObject({ kind: 'assistant', id: 'event-1' })
    expect(view.artifacts).toHaveLength(1)
    expect(view.artifacts[0]).toMatchObject({ language: 'ts', content: code })
  })

  it('attaches tool results and accumulates usage without mutating the previous view', () => {
    const toolView = reduceSessionView(
      EMPTY_SESSION_VIEW,
      { t: 'tool-use', toolUseId: 'tool-1', name: 'Edit', input: { file_path: 'App.tsx' } },
      'event-1',
    )
    const resultView = reduceSessionView(
      toolView,
      { t: 'tool-result', toolUseId: 'tool-1', ok: true, preview: 'updated' },
      'event-2',
    )
    const usageView = reduceSessionView(
      resultView,
      {
        t: 'usage',
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalCostUsd: 0.01,
        },
      },
      'event-3',
    )

    expect(toolView.entries[0]).not.toHaveProperty('result')
    expect(resultView.entries[0]).toMatchObject({ result: { ok: true, preview: 'updated' } })
    expect(usageView).toMatchObject({ cost: 0.01, tokens: 150 })
  })
})

describe('splitSessionTabs', () => {
  it('keeps the active session visible when the tab row overflows', () => {
    const sessions = ['one', 'two', 'three', 'four'].map(session)
    const { visible, overflow } = splitSessionTabs(sessions, 'four', 276)

    expect(visible.map(({ id }) => id)).toEqual(['one', 'four'])
    expect(overflow.map(({ id }) => id)).toEqual(['two', 'three'])
  })
})
