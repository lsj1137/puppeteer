import { describe, expect, it } from 'vitest'
import type { StoredSession } from '@shared/session'
import { resolveSessionLaunch } from './session-launch'

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
})
