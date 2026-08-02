import { describe, expect, it } from 'vitest'
import type { ApprovalRequest } from '@shared/session'
import { approvalNavigationPath, sessionRunPath } from './navigation'

const approval = (projectPath?: string): ApprovalRequest => ({
  id: 'approval-1',
  sessionId: 'session-1',
  projectPath,
  tool: 'Write',
  input: {},
  cwd: '/app-data/worktrees/session-1',
  risk: 'med',
  pending: false,
})

describe('approval navigation', () => {
  it('opens the original project instead of the isolated worktree cwd', () => {
    expect(approvalNavigationPath(approval('/projects/example'))).toBe('/projects/example')
  })

  it('falls back to cwd for approvals created by older versions', () => {
    expect(approvalNavigationPath(approval())).toBe('/app-data/worktrees/session-1')
  })
})

describe('session command path', () => {
  it('continues an open session in its stored original project', () => {
    expect(sessionRunPath(undefined, '/projects/example', '/app-data/worktrees/session-1')).toBe(
      '/projects/example',
    )
  })

  it('keeps explicit routed commands and new-session project selection', () => {
    expect(sessionRunPath('/projects/routed', '/projects/example', '/projects/active')).toBe(
      '/projects/routed',
    )
    expect(sessionRunPath(undefined, undefined, '/projects/active')).toBe('/projects/active')
  })
})
