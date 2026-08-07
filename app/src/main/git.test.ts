import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addWorktree,
  abortWorktreeRebase,
  commitProjectMemory,
  commitWorktree,
  mergeWorktree,
  removeWorktree,
  rebaseWorktree,
  resolveWorktreeConflicts,
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

async function fixture(initialFiles: Record<string, string | Uint8Array> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'agent-workspace-worktree-'))
  roots.push(root)
  const origin = join(root, 'origin')
  const worktreePath = join(root, 'worktree')
  await mkdir(origin)
  await git(origin, ['init', '-b', 'main'])
  await git(origin, ['config', 'user.name', 'Agent Workspace Test'])
  await git(origin, ['config', 'user.email', 'test@example.com'])
  await writeFile(join(origin, 'README.md'), 'base\n')
  for (const [path, content] of Object.entries(initialFiles)) {
    await writeFile(join(origin, path), content)
  }
  await commit(origin, 'initial')

  const made = await addWorktree(origin, worktreePath, 'puppeteer/test')
  if (!made) throw new Error('worktree fixture creation failed')
  return { origin, worktreePath, wt: { ...made, origin } }
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
    ),
  )
})

describe('worktree merge', () => {
  it('commits only approved project Memory files and leaves unrelated changes untouched', async () => {
    const { origin } = await fixture()
    await writeFile(join(origin, 'AGENTS.md'), 'approved memory\n')
    await writeFile(join(origin, 'CLAUDE.md'), '@AGENTS.md\n')
    await writeFile(join(origin, 'local.txt'), 'unrelated\n')

    const result = await commitProjectMemory(origin)

    expect(result.ok).toBe(true)
    expect((await git(origin, ['show', '--pretty=', '--name-only', 'HEAD'])).split(/\r?\n/)).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
    ])
    expect(await git(origin, ['status', '--porcelain'])).toBe('?? local.txt')
  })

  it('removes a clean worktree and its already-merged branch', async () => {
    const { origin, worktreePath, wt } = await fixture()

    const result = await removeWorktree(origin, worktreePath, wt.branch)

    expect(result).toMatchObject({ ok: true, branchRemoved: true })
    await expect(git(origin, ['show-ref', '--verify', `refs/heads/${wt.branch}`])).rejects.toThrow()
  })

  it('returns the Git reason when an uncommitted worktree cannot be removed', async () => {
    const { origin, worktreePath, wt } = await fixture()
    await writeFile(join(worktreePath, 'draft.txt'), 'draft\n')

    const result = await removeWorktree(origin, worktreePath, wt.branch)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('worktree 폴더를 정리하지 못했습니다')
    expect(result.message).toMatch(/modified|untracked/i)
  })

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

  it('serializes concurrent commits for the same worktree', async () => {
    const { worktreePath, wt } = await fixture()
    await writeFile(join(worktreePath, 'queued.txt'), 'queued\n')

    const results = await Promise.all([
      commitWorktree(wt, 'feat: queued 변경 반영'),
      commitWorktree(wt, 'feat: 중복 커밋 시도'),
    ])

    expect(results.filter(({ ok }) => ok)).toHaveLength(1)
    expect(results.find(({ ok }) => !ok)?.message).toContain('커밋할 worktree 변경이 없습니다')
    expect(await git(worktreePath, ['log', '-1', '--pretty=%s'])).toBe('feat: queued 변경 반영')
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

  it('keeps a conflicted rebase for the resolver and can abort it cleanly', async () => {
    const { origin, worktreePath, wt } = await fixture()
    await writeFile(join(worktreePath, 'shared.txt'), 'worktree\n')
    await commit(worktreePath, 'worktree shared')
    const beforeHead = await git(worktreePath, ['rev-parse', 'HEAD'])

    await writeFile(join(origin, 'shared.txt'), 'origin\n')
    await commit(origin, 'origin shared')

    const result = await rebaseWorktree(wt)

    expect(result.ok).toBe(false)
    expect(result.conflictFiles).toContain('shared.txt')
    expect(await git(worktreePath, ['status', '--porcelain'])).toContain('AA shared.txt')
    expect(await worktreeStatus(wt)).toMatchObject({
      dirty: true,
      canMerge: false,
      conflictFiles: ['shared.txt'],
    })

    const file = await worktreeConflictFile(wt, 'shared.txt')
    expect(file).toMatchObject({
      path: 'shared.txt',
      originContent: 'origin\n',
      worktreeContent: 'worktree\n',
      originMissing: false,
      worktreeMissing: false,
    })
    expect(file.originLabel).toContain('현재 rebase 원본')

    await abortWorktreeRebase(wt)
    expect(await git(worktreePath, ['rev-parse', 'HEAD'])).toBe(beforeHead)
    expect(await git(worktreePath, ['status', '--porcelain'])).toBe('')
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

  it('continues a conflicted rebase with custom resolved content', async () => {
    const { origin, worktreePath, wt } = await fixture()
    await writeFile(join(worktreePath, 'shared.txt'), 'worktree\n')
    await commit(worktreePath, 'worktree shared')

    await writeFile(join(origin, 'shared.txt'), 'origin\n')
    await commit(origin, 'origin shared')

    const result = await resolveWorktreeConflicts(wt, [
      { path: 'shared.txt', content: 'origin\nworktree\n' },
    ])

    expect(result.ok).toBe(true)
    expect(await git(worktreePath, ['show', 'HEAD:shared.txt'])).toBe('origin\nworktree')
    expect(result.status).toMatchObject({ canMerge: true, ahead: 1, behind: 0 })
  })

  it('preserves a custom resolution without adding a final newline', async () => {
    const { origin, worktreePath, wt } = await fixture({ 'shared.txt': 'base' })
    await writeFile(join(worktreePath, 'shared.txt'), 'worktree')
    await commit(worktreePath, 'worktree shared')
    await writeFile(join(origin, 'shared.txt'), 'origin')
    await commit(origin, 'origin shared')

    const result = await resolveWorktreeConflicts(wt, [{ path: 'shared.txt', content: 'combined' }])

    expect(result.ok).toBe(true)
    expect(await readFile(join(worktreePath, 'shared.txt'), 'utf8')).toBe('combined')
  })

  it('resolves a modify/delete conflict by deleting the file', async () => {
    const { origin, worktreePath, wt } = await fixture({ 'shared.txt': 'base\n' })
    await unlink(join(worktreePath, 'shared.txt'))
    await commit(worktreePath, 'delete shared')
    await writeFile(join(origin, 'shared.txt'), 'origin\n')
    await commit(origin, 'modify shared')

    const conflict = await worktreeConflictFile(wt, 'shared.txt')
    expect(conflict).toMatchObject({ originMissing: false, worktreeMissing: true, binary: false })
    const result = await resolveWorktreeConflicts(wt, [{ path: 'shared.txt', deleted: true }])

    expect(result.ok).toBe(true)
    await expect(readFile(join(worktreePath, 'shared.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('selects one complete side for a binary conflict', async () => {
    const base = Uint8Array.from([0, 1, 2])
    const worktreeBytes = Uint8Array.from([0, 3, 4])
    const originBytes = Uint8Array.from([0, 5, 6])
    const { origin, worktreePath, wt } = await fixture({ 'asset.bin': base })
    await writeFile(join(worktreePath, 'asset.bin'), worktreeBytes)
    await commit(worktreePath, 'worktree binary')
    await writeFile(join(origin, 'asset.bin'), originBytes)
    await commit(origin, 'origin binary')

    const conflict = await worktreeConflictFile(wt, 'asset.bin')
    expect(conflict.binary).toBe(true)
    const result = await resolveWorktreeConflicts(wt, [{ path: 'asset.bin', side: 'worktree' }])

    expect(result.ok).toBe(true)
    expect(await readFile(join(worktreePath, 'asset.bin'))).toEqual(Buffer.from(worktreeBytes))
  })

  it('returns the next conflict and continues a multi-commit rebase', async () => {
    const { origin, worktreePath, wt } = await fixture({
      'first.txt': 'base\n',
      'second.txt': 'base\n',
    })
    await writeFile(join(worktreePath, 'first.txt'), 'worktree first\n')
    await commit(worktreePath, 'worktree first')
    await writeFile(join(worktreePath, 'second.txt'), 'worktree second\n')
    await commit(worktreePath, 'worktree second')
    await writeFile(join(origin, 'first.txt'), 'origin first\n')
    await writeFile(join(origin, 'second.txt'), 'origin second\n')
    await commit(origin, 'origin files')

    const first = await resolveWorktreeConflicts(wt, [
      { path: 'first.txt', content: 'resolved first\n' },
    ])
    expect(first).toMatchObject({ ok: false, conflictFiles: ['second.txt'] })
    const activeConflict = await worktreeConflictFile(wt, 'second.txt')
    expect(activeConflict.originLabel).toContain('현재 rebase 원본')

    const second = await resolveWorktreeConflicts(wt, [
      { path: 'second.txt', content: 'resolved second\n' },
    ])
    expect(second.ok).toBe(true)
    expect(await readFile(join(worktreePath, 'first.txt'), 'utf8')).toBe('resolved first\n')
    expect(await readFile(join(worktreePath, 'second.txt'), 'utf8')).toBe('resolved second\n')
  })

  it('uses the current rebase stage when the same file conflicts again', async () => {
    const base = 'first base\nkeep 1\nkeep 2\nkeep 3\nlast base\n'
    const { origin, worktreePath, wt } = await fixture({ 'shared.txt': base })
    await writeFile(join(worktreePath, 'shared.txt'), base.replace('first base', 'first worktree'))
    await commit(worktreePath, 'worktree first line')
    await writeFile(
      join(worktreePath, 'shared.txt'),
      (await readFile(join(worktreePath, 'shared.txt'), 'utf8')).replace('last base', 'last worktree'),
    )
    await commit(worktreePath, 'worktree last line')
    await writeFile(
      join(origin, 'shared.txt'),
      base.replace('first base', 'first origin').replace('last base', 'last origin'),
    )
    await commit(origin, 'origin first and last')

    const firstStage = await rebaseWorktree(wt)
    expect(firstStage.conflictFiles).toEqual(['shared.txt'])
    const firstConflict = await worktreeConflictFile(wt, 'shared.txt')
    expect(firstConflict.worktreeContent).toContain('last base')
    const first = await resolveWorktreeConflicts(wt, [
      {
        path: 'shared.txt',
        content: firstConflict.originContent.replace('first origin', 'first resolved'),
      },
    ])
    expect(first.conflictFiles).toEqual(['shared.txt'])

    const secondConflict = await worktreeConflictFile(wt, 'shared.txt')
    expect(secondConflict.originContent).toContain('first resolved')
    const second = await resolveWorktreeConflicts(wt, [
      {
        path: 'shared.txt',
        content: secondConflict.worktreeContent.replace('last worktree', 'last resolved'),
      },
    ])

    expect(second.ok).toBe(true)
    expect(await readFile(join(worktreePath, 'shared.txt'), 'utf8')).toContain('last resolved')
  }, 15_000)

  it('aborts an in-progress multi-commit resolution cleanly', async () => {
    const { origin, worktreePath, wt } = await fixture({
      'first.txt': 'base\n',
      'second.txt': 'base\n',
    })
    await writeFile(join(worktreePath, 'first.txt'), 'worktree first\n')
    await commit(worktreePath, 'worktree first')
    await writeFile(join(worktreePath, 'second.txt'), 'worktree second\n')
    await commit(worktreePath, 'worktree second')
    const originalHead = await git(worktreePath, ['rev-parse', 'HEAD'])
    await writeFile(join(origin, 'first.txt'), 'origin first\n')
    await writeFile(join(origin, 'second.txt'), 'origin second\n')
    await commit(origin, 'origin files')

    const first = await resolveWorktreeConflicts(wt, [
      { path: 'first.txt', content: 'resolved first\n' },
    ])
    expect(first.conflictFiles).toEqual(['second.txt'])
    await abortWorktreeRebase(wt)

    expect(await git(worktreePath, ['rev-parse', 'HEAD'])).toBe(originalHead)
    expect(await git(worktreePath, ['status', '--porcelain'])).toBe('')
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
