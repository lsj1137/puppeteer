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

  it('keeps a memory proposal as an actionable conversation entry', () => {
    const view = reduceSessionView(
      EMPTY_SESSION_VIEW,
      {
        t: 'memory-proposal',
        proposal: {
          id: 7,
          sessionId: 'session-1',
          entryId: 'project:C:\\repo',
          scope: 'project',
          content: '- 릴리스 전 verify를 실행한다.',
          reason: '반복되는 프로젝트 검증 규칙입니다.',
          status: 'pending',
          createdAt: 1,
        },
      },
      'event-memory-1',
    )

    expect(view.entries[0]).toMatchObject({
      kind: 'memory-proposal',
      id: 'event-memory-1',
      proposal: { id: 7, scope: 'project' },
    })
  })
})

describe('멀티 Agent run 이벤트', () => {
  // 1단계는 식별자만 도입하고 화면 동작은 그대로 둔다. 보조 run 이벤트가 흘러들어와도
  // 기존 대화 뷰가 흔들리지 않아야 다음 단계에서 UI를 안전하게 얹을 수 있다.
  it('아직 화면을 바꾸지 않는다', () => {
    const started = reduceSessionView(
      EMPTY_SESSION_VIEW,
      { t: 'message', role: 'user', messageId: 'u-1', text: '조사해줘' },
      'event-user-1',
    )

    const afterRuns = [
      {
        t: 'run-start' as const,
        run: {
          id: 'run-1',
          sessionId: 'session-1',
          role: 'sub' as const,
          agentName: null,
          runnerId: 'claude-windows',
          task: '문서 훑기',
          status: 'running' as const,
          costUsd: 0,
          startedAt: 0,
        },
      },
      { t: 'run-status' as const, runId: 'run-1', status: 'completed' as const },
      { t: 'run-result' as const, runId: 'run-1', ok: true, summary: '요약' },
    ].reduce((view, event, index) => reduceSessionView(view, event, `event-run-${index}`), started)

    expect(afterRuns).toEqual(started)
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
