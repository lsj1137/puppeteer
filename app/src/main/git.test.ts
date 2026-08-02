import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addWorktree,
  commitWorktree,
  mergeWorktree,
  rebaseWorktree,
  worktreeConflictFile,
  worktreeDiff,
  worktreeStatus,
} from './git'

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, args: string[]): Promise<string> {
  return (await exec('git', args, { cwd })).stdout.trim()
}

async function commit(cwd: string, message: string): Promise<void> {
  await git(cwd, ['add', '.'])
  await git(cwd, ['commit', '-m', message])
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agent-workspace-worktree-'))
  roots.push(root)
  const origin = join(root, 'origin')
  const worktreePath = join(root, 'worktree')
  await mkdir(origin)
  await git(origin, ['init', '-b', 'main'])
  await git(origin, ['config', 'user.name', 'Agent Workspace Test'])
  await git(origin, ['config', 'user.email', 'test@example.com'])
  await writeFile(join(origin, 'README.md'), 'base\n')
  await commit(origin, 'initial')

  const made = await addWorktree(origin, worktreePath, 'puppeteer/test')
  if (!made) throw new Error('worktree fixture creation failed')
  return { origin, worktreePath, wt: { ...made, origin } }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('worktree merge', () => {
  it('distinguishes an untouched worktree from a merged one', async () => {
    const { wt } = await fixture()

    const status = await worktreeStatus(wt)

    expect(status).toMatchObject({
      canMerge: false,
      hasCommits: false,
      merged: false,
      ahead: 0,
    })
    expect(status.reason).toContain('반영할 worktree 커밋')
  })

  it('records the source branch and fast-forwards committed work', async () => {
    const { origin, worktreePath, wt } = await fixture()
    expect(wt.baseBranch).toBe('main')
    expect(wt.baseHead).toMatch(/^[0-9a-f]{40}$/)

    await writeFile(join(worktreePath, 'feature.txt'), 'done\n')
    await git(worktreePath, ['config', 'user.name', 'Agent Workspace Test'])
    await git(worktreePath, ['config', 'user.email', 'test@example.com'])
    await commit(worktreePath, 'feature')

    const before = await worktreeStatus(wt)
    expect(before).toMatchObject({
      canMerge: true,
      hasCommits: true,
      ahead: 1,
      behind: 0,
      merged: false,
    })
    expect(await worktreeDiff(wt)).toContain('feature.txt')

    const result = await mergeWorktree(wt)
    expect(result.ok).toBe(true)
    expect(await git(origin, ['rev-parse', 'main'])).toBe(await git(origin, ['rev-parse', wt.branch]))
    expect(result.status).toMatchObject({ canMerge: false, hasCommits: true, merged: true, ahead: 0 })
    expect(await worktreeDiff(wt)).toContain('feature.txt')
  })

  it('blocks a merge while the worktree has uncommitted changes', async () => {
    const { worktreePath, wt } = await fixture()
    await writeFile(join(worktreePath, 'draft.txt'), 'draft\n')

    const result = await mergeWorktree(wt)
    expect(result.ok).toBe(false)
    expect(result.status).toMatchObject({ dirty: true, canMerge: false })
    expect(result.message).toContain('커밋되지 않은 변경')
  })

  it('commits dirty worktree changes before merge', async () => {
    const { worktreePath, wt } = await fixture()
    await writeFile(join(worktreePath, 'draft.txt'), 'draft\n')

    const result = await commitWorktree(wt, 'draft commit')

    expect(result.ok).toBe(true)
    expect(result.status).toMatchObject({
      dirty: false,
      hasCommits: true,
      ahead: 1,
      canMerge: true,
    })
    expect(await worktreeDiff(wt)).toContain('draft.txt')
  })

  it('blocks a merge while the original checkout has uncommitted changes', async () => {
    const { origin, worktreePath, wt } = await fixture()
    await git(worktreePath, ['config', 'user.name', 'Agent Workspace Test'])
    await git(worktreePath, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(worktreePath, 'feature.txt'), 'feature\n')
    await commit(worktreePath, 'feature')
    await writeFile(join(origin, 'README.md'), 'local edit\n')

    const result = await mergeWorktree(wt)
    expect(result.ok).toBe(false)
    expect(result.status).toMatchObject({ originDirty: true, canMerge: false })
    expect(result.message).toContain('원본 프로젝트에 커밋되지 않은 변경')
  })

  it('blocks a fast-forward merge after the branches diverge', async () => {
    const { origin, worktreePath, wt } = await fixture()
    await git(worktreePath, ['config', 'user.name', 'Agent Workspace Test'])
    await git(worktreePath, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(worktreePath, 'feature.txt'), 'feature\n')
    await commit(worktreePath, 'feature')

    await writeFile(join(origin, 'origin.txt'), 'origin\n')
    await commit(origin, 'origin change')

    const status = await worktreeStatus(wt)
    expect(status).toMatchObject({ canMerge: false, ahead: 1, behind: 1 })
    expect(status.reason).toContain('갈라져')
  })

  it('rebases a diverged worktree onto the updated source branch', async () => {
    const { origin, worktreePath, wt } = await fixture()
    await writeFile(join(worktreePath, 'feature.txt'), 'feature\n')
    await commit(worktreePath, 'feature')
    await writeFile(join(origin, 'origin.txt'), 'origin\n')
    await commit(origin, 'origin change')

    const result = await rebaseWorktree(wt)

    expect(result.ok).toBe(true)
    expect(result.status).toMatchObject({ canMerge: true, ahead: 1, behind: 0 })
    expect(result.status?.worktree.baseHead).toBe(await git(origin, ['rev-parse', 'main']))
    expect(await worktreeDiff(result.status?.worktree ?? wt)).toContain('feature.txt')
    expect(await worktreeDiff(result.status?.worktree ?? wt)).not.toContain('origin.txt')
  })

  it('aborts a rebase and reports conflict files', async () => {
    const { origin, worktreePath, wt } = await fixture()
    await writeFile(join(worktreePath, 'shared.txt'), 'worktree\n')
    await commit(worktreePath, 'worktree shared')
    const beforeHead = await git(worktreePath, ['rev-parse', 'HEAD'])

    await writeFile(join(origin, 'shared.txt'), 'origin\n')
    await commit(origin, 'origin shared')

    const result = await rebaseWorktree(wt)

    expect(result.ok).toBe(false)
    expect(result.conflictFiles).toContain('shared.txt')
    expect(await git(worktreePath, ['rev-parse', 'HEAD'])).toBe(beforeHead)
    expect(await git(worktreePath, ['status', '--porcelain'])).toBe('')

    const file = await worktreeConflictFile(wt, 'shared.txt')
    expect(file).toMatchObject({
      path: 'shared.txt',
      originContent: 'origin\n',
      worktreeContent: 'worktree\n',
      originMissing: false,
      worktreeMissing: false,
    })
  })

  it('resolves rebase conflicts by preferring worktree files', async () => {
    const { origin, worktreePath, wt } = await fixture()
    await writeFile(join(worktreePath, 'shared.txt'), 'worktree\n')
    await commit(worktreePath, 'worktree shared')

    await writeFile(join(origin, 'shared.txt'), 'origin\n')
    await commit(origin, 'origin shared')

    const result = await rebaseWorktree(wt, 'worktree')

    expect(result.ok).toBe(true)
    expect(await git(worktreePath, ['show', 'HEAD:shared.txt'])).toBe('worktree')
    expect(result.status).toMatchObject({ canMerge: true, ahead: 1, behind: 0 })
  })

  it('resolves rebase conflicts by preferring source branch files', async () => {
    const { origin, worktreePath, wt } = await fixture()
    await writeFile(join(worktreePath, 'shared.txt'), 'worktree\n')
    await commit(worktreePath, 'worktree shared')

    await writeFile(join(origin, 'shared.txt'), 'origin\n')
    await commit(origin, 'origin shared')

    const result = await rebaseWorktree(wt, 'origin')

    expect(result.ok).toBe(true)
    expect(await git(worktreePath, ['show', 'HEAD:shared.txt'])).toBe('origin')
    expect(result.status).toMatchObject({
      canMerge: false,
      hasCommits: false,
      ahead: 0,
      behind: 0,
      merged: false,
    })
  })

  it('blocks a merge when the original checkout is on another branch', async () => {
    const { origin, worktreePath, wt } = await fixture()
    await git(worktreePath, ['config', 'user.name', 'Agent Workspace Test'])
    await git(worktreePath, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(worktreePath, 'feature.txt'), 'feature\n')
    await commit(worktreePath, 'feature')
    await git(origin, ['switch', '-c', 'other'])

    const status = await worktreeStatus(wt)
    expect(status).toMatchObject({ currentBranch: 'other', canMerge: false })
    expect(status.reason).toContain('main 브랜치로 전환')
  })
})
