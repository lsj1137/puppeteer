import { describe, expect, it, vi } from 'vitest'
import type { AgentDef, AgentWorkspaceConfig } from '@shared/session'

// 라이브러리 경로 계산에 electron app 이 필요하다. 순수 판단 함수만 볼 것이므로 막는다.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/userData' },
}))

const { allowsProvider, appliesTo, unenforcedPathScopes } = await import('./agent-library')

const agent = (workspace: AgentWorkspaceConfig): AgentDef => ({
  name: 'docs-writer',
  description: '문서 정리',
  instructions: '문서를 정리한다',
  filePath: '/userData/agents/docs-writer.md',
  scope: 'library',
  workspace,
})

describe('unenforcedPathScopes', () => {
  // 경계를 걸었다고 믿게 두는 것이 기능이 없는 것보다 나쁘다. 무엇이 안 걸리는지 드러내야 한다.
  it('선언됐지만 강제되지 않는 경로 설정을 짚어낸다', () => {
    expect(unenforcedPathScopes(agent({ readPaths: ['docs/**'] }))).toEqual(['readPaths'])
    expect(unenforcedPathScopes(agent({ writePaths: ['docs/**'] }))).toEqual(['writePaths'])
    expect(unenforcedPathScopes(agent({ readPaths: ['a'], writePaths: ['b'] }))).toEqual([
      'readPaths',
      'writePaths',
    ])
  })

  it('선언이 없거나 비어 있으면 알리지 않는다', () => {
    expect(unenforcedPathScopes(agent({}))).toEqual([])
    expect(unenforcedPathScopes(agent({ readPaths: [], writePaths: [] }))).toEqual([])
  })

  // 실제로 강제되는 설정까지 경고하면 경고가 무의미해진다.
  it('실제로 강제되는 도구 제한은 대상이 아니다', () => {
    expect(unenforcedPathScopes(agent({ allowedTools: ['Read'], disallowedTools: ['Bash'] }))).toEqual(
      [],
    )
  })
})

describe('appliesTo / allowsProvider', () => {
  it('적용 대상이 비어 있으면 전체 허용', () => {
    expect(appliesTo(agent({}), 'C:\\repo')).toBe(true)
    expect(appliesTo(agent({ projects: ['C:\\other'] }), 'C:\\repo')).toBe(false)
  })

  it('provider 제한은 마지막 방어선이다', () => {
    expect(allowsProvider(agent({}), 'codex-cli')).toBe(true)
    expect(allowsProvider(agent({ providers: ['claude-cli'] }), 'codex-cli')).toBe(false)
  })
})
