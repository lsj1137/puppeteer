import { describe, expect, it } from 'vitest'
import type { StoredSession } from '@shared/session'
import { resolveSessionAgent, resolveSessionLaunch } from './session-launch'

const session = (runnerId: string | null, cliSessionId: string | null): StoredSession => ({
  id: 'app-session',
  projectPath: 'C:\\repo',
  cliSessionId,
  runnerId,
  title: 'session',
  status: 'completed',
  costUsd: 0,
  startedAt: 0,
  endedAt: null,
})

describe('resolveSessionLaunch', () => {
  it('resumes the same CLI session when the runner matches', () => {
    expect(resolveSessionLaunch('runner-a', 'app-session', session('runner-a', 'cli-1'), 'C:\\repo')).toEqual({
      path: 'C:\\repo',
      sameRunner: true,
      resumeCliSessionId: 'cli-1',
      continueSessionId: 'app-session',
    })
  })

  it('starts fresh when the runner changes', () => {
    expect(resolveSessionLaunch('runner-b', 'app-session', session('runner-a', 'cli-1'), 'C:\\repo')).toEqual({
      path: 'C:\\repo',
      sameRunner: false,
      resumeCliSessionId: undefined,
      continueSessionId: undefined,
    })
  })

  it('resumes a legacy session whose runner id was not persisted', () => {
    expect(resolveSessionLaunch('runner-a', 'app-session', session(null, 'cli-1'), 'C:\\repo')).toEqual({
      path: 'C:\\repo',
      sameRunner: true,
      resumeCliSessionId: 'cli-1',
      continueSessionId: 'app-session',
    })
  })
})

describe('resolveSessionAgent', () => {
  const withAgent = (agentName: string | null): StoredSession => ({
    ...session('runner-a', 'cli-1'),
    agentName,
  })

  it('세션이 열려 있으면 그 세션에 저장된 Agent 를 쓴다', () => {
    expect(resolveSessionAgent(withAgent('kcc-recruit'), 'explorer')).toBe('kcc-recruit')
  })

  // 이전에는 이동할 때 상태를 비우지 않으면 직전 세션의 Agent 가 새 세션에 딸려갔다.
  it('Agent 없이 시작한 세션에는 직전 선택이 딸려가지 않는다', () => {
    expect(resolveSessionAgent(withAgent(null), 'kcc-recruit')).toBeUndefined()
  })

  it('새 세션 화면에서는 이번에 고른 값을 쓴다', () => {
    expect(resolveSessionAgent(undefined, 'explorer')).toBe('explorer')
    expect(resolveSessionAgent(undefined, undefined)).toBeUndefined()
  })
})
