import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/app' } }))

const { accessDirs } = await import('./paths')
const { buildClaudeArgs } = await import('./adapters/claude-cli')
const { buildCodexArgs } = await import('./adapters/codex-cli')

describe('accessDirs', () => {
  it('작업 폴더 자신과 중복은 빼고, 상대 경로는 프로젝트 기준으로 푼다', () => {
    const dirs = accessDirs('C:\\wt\\abc', 'C:\\proj', [
      'C:\\proj',
      'C:\\wt\\abc\\', // 작업 폴더 자신
      'c:/proj', // 같은 폴더, 표기만 다름
      undefined,
      '  ',
      'D:\\data',
      'docs',
    ])
    expect(dirs).toEqual(['C:\\proj', 'D:\\data', expect.stringMatching(/proj[\\/]docs$/)])
  })
})

describe('Claude 권한 인자', () => {
  it('자동 승인 세션은 CLI 자체 권한 검사도 푼다', () => {
    const args = buildClaudeArgs({ prompt: 'p', approvalMode: 'auto' })
    expect(args).toEqual(expect.arrayContaining(['--permission-mode', 'bypassPermissions']))
  })

  it('매번 확인 세션은 권한 검사를 그대로 둔다', () => {
    expect(buildClaudeArgs({ prompt: 'p', approvalMode: 'ask' })).not.toContain('--permission-mode')
    expect(buildClaudeArgs({ prompt: 'p' })).not.toContain('--permission-mode')
  })

  it('허용 폴더는 폴더마다 --add-dir 을 따로 붙인다(여러 값 옵션이 뒤 인자를 삼키지 않게)', () => {
    const args = buildClaudeArgs({ prompt: 'p', addDirs: ['/mnt/c/proj', '/mnt/c/skills'] })
    const at = args.indexOf('--add-dir')
    expect(args.slice(at, at + 4)).toEqual(['--add-dir', '/mnt/c/proj', '--add-dir', '/mnt/c/skills'])
  })
})

describe('Codex 권한 인자', () => {
  it('자동 승인 세션은 OS 샌드박스도 푼다', () => {
    const args = buildCodexArgs({ prompt: 'p', approvalMode: 'auto', addDirs: ['/x'] })
    expect(args).toEqual(expect.arrayContaining(['--sandbox', 'danger-full-access']))
    expect(args).not.toContain('workspace-write')
    // 전체 접근이면 허용 폴더는 군더더기다.
    expect(args).not.toContain('--add-dir')
  })

  it('매번 확인 세션은 workspace-write 에 허용 폴더만 쓰기 가능으로 연다. resume 보다 앞', () => {
    const args = buildCodexArgs({ prompt: 'p', addDirs: ['/mnt/c/proj'], resumeSessionId: 's1' })
    expect(args).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write', '--add-dir', '/mnt/c/proj']))
    expect(args.indexOf('--add-dir')).toBeLessThan(args.indexOf('resume'))
  })
})
