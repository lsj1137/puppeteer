import { describe, expect, it } from 'vitest'
import type { SessionEvent, StoredSession } from '@shared/session'
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
  const startRun = (id: string, task: string): SessionEvent => ({
    t: 'run-start',
    run: {
      id,
      sessionId: 'session-1',
      role: 'sub',
      agentName: null,
      runnerId: 'claude-windows',
      task,
      status: 'running',
      costUsd: 0,
      startedAt: 0,
    },
  })

  // 같은 턴에 병렬로 뜬 보조는 카드 하나로 묶여야 한다. 줄줄이 쌓이면 대화를 밀어낸다.
  it('한 턴의 보조들을 카드 하나에 모은다', () => {
    const view = [startRun('run-1', '문서 훑기'), startRun('run-2', '로그 확인')].reduce(
      (current, event, index) => reduceSessionView(current, event, `event-run-${index}`),
      EMPTY_SESSION_VIEW,
    )

    expect(view.entries).toHaveLength(1)
    expect(view.entries[0]).toMatchObject({
      kind: 'delegation',
      runs: [{ runId: 'run-1' }, { runId: 'run-2' }],
    })
  })

  it('결과가 오면 해당 run 만 갱신한다', () => {
    const view = [
      startRun('run-1', '문서 훑기'),
      startRun('run-2', '로그 확인'),
      { t: 'run-result', runId: 'run-2', ok: false, summary: '시간 초과', costUsd: 0.02 },
    ].reduce(
      (current, event, index) => reduceSessionView(current, event as SessionEvent, `e${index}`),
      EMPTY_SESSION_VIEW,
    )

    const entry = view.entries[0]
    expect(entry?.kind === 'delegation' && entry.runs).toMatchObject([
      { runId: 'run-1', status: 'running', ok: undefined },
      { runId: 'run-2', status: 'failed', ok: false, summary: '시간 초과', costUsd: 0.02 },
    ])
  })

  it('모르는 run 의 결과는 뷰를 건드리지 않는다', () => {
    const view = reduceSessionView(EMPTY_SESSION_VIEW, startRun('run-1', '문서 훑기'), 'e0')
    const after = reduceSessionView(
      view,
      { t: 'run-result', runId: 'unknown', ok: true, summary: '' },
      'e1',
    )
    expect(after).toBe(view)
  })

  it('다음 턴의 위임은 새 카드가 된다', () => {
    const first = [
      startRun('run-1', '문서 훑기'),
      { t: 'run-result', runId: 'run-1', ok: true, summary: '완료' },
    ].reduce(
      (current, event, index) => reduceSessionView(current, event as SessionEvent, `a${index}`),
      EMPTY_SESSION_VIEW,
    )
    const second = reduceSessionView(first, startRun('run-2', '두 번째 턴'), 'b0')

    expect(second.entries).toHaveLength(2)
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
