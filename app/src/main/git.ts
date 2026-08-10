import { execFile } from 'node:child_process'
import { lstat, mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  GitSnapshot,
  GitHistoryEntry,
  WorktreeCommitResult,
  WorktreeCleanupResult,
  WorktreeConflictFile,
  WorktreeResolvedFile,
  SessionWorktree,
  WorktreeMergeResult,
  WorktreeRebaseResult,
  WorktreeRebaseStrategy,
  WorktreeStatus,
} from '@shared/session'

const exec = promisify(execFile)
const repositoryMutationQueues = new Map<string, Promise<void>>()

/** 같은 저장소의 Memory·worktree 커밋·병합이 index/refs lock을 두고 경쟁하지 않게 한다. */
async function serializeRepositoryMutation<T>(origin: string, task: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? resolve(origin).toLowerCase() : resolve(origin)
  const previous = repositoryMutationQueues.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.catch(() => undefined).then(() => current)
  repositoryMutationQueues.set(key, queued)
  await previous.catch(() => undefined)
  try {
    return await task()
  } finally {
    release()
    if (repositoryMutationQueues.get(key) === queued) repositoryMutationQueues.delete(key)
  }
}

function hostGitArgs(args: string[]): string[] {
  // Windows와 WSL이 같은 worktree를 볼 때 Git 전역 설정 차이만으로 전체 파일이
  // dirty가 되는 것을 막는다. 저장소의 .gitattributes 규칙은 이 설정보다 우선한다.
  return process.platform === 'win32' ? ['-c', 'core.autocrlf=true', ...args] : args
}

/**
 * git 은 호스트(Windows)에서 실행한다.
 * WSL 프로젝트도 경로가 /mnt/c 로 매핑된 같은 디스크라 Windows git 으로 읽을 수 있고,
 * 러너를 거치지 않아 세션이 죽어도 스냅샷 조회가 가능하다.
 */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', hostGitArgs(args), {
    cwd,
    timeout: 20_000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

/** 사이드바에서 사용할 최근 Git 이력. 구분 문자를 써서 로케일과 공백에 영향받지 않게 파싱한다. */
export async function gitHistory(cwd: string, limit = 50): Promise<GitHistoryEntry[]> {
  const count = Math.max(1, Math.min(limit, 200))
  try {
    const output = await git(cwd, [
      'log',
      `-${count}`,
      '--date=iso-strict',
      '--decorate=short',
      '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%D%x1e',
    ])
    return output
      .split('\x1e')
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => {
        const [hash = '', shortHash = '', subject = '', author = '', authoredAt = '', decorations = ''] = row.split('\x1f')
        return {
          hash,
          shortHash,
          subject,
          author,
          authoredAt,
          refs: decorations.split(',').map((ref) => ref.trim()).filter(Boolean),
        }
      })
  } catch {
    return []
  }
}

async function gitWithError(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec('git', hostGitArgs(args), {
      cwd,
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_EDITOR: 'true' },
    })
    return { stdout, stderr }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    throw new Error(formatGitError(err.stderr || err.stdout || err.message || 'git 명령 실행에 실패했습니다.'))
  }
}

export function formatGitError(raw: string): string {
  const message = raw.trim()
  const lock = message.match(/Unable to create ['"]([^'"]+index\.lock)['"]/i)?.[1]
  if (!lock) return message
  return `Git 잠금 파일 때문에 작업을 시작하지 못했습니다: ${lock}\n실행 중인 Git 작업을 먼저 종료하세요. 실행 중인 작업이 없다면 이전 Git 프로세스가 남긴 잠금 파일인지 확인한 뒤 해당 index.lock만 삭제하고 다시 시도하세요.`
}

async function unmergedFiles(cwd: string): Promise<string[]> {
  return git(cwd, ['diff', '--name-only', '--diff-filter=U'])
    .then((out) => out.split('\n').map((line) => line.trim()).filter(Boolean))
    .catch(() => [])
}

function safeWorktreePath(root: string, path: string): string {
  const full = resolve(root, path)
  const base = resolve(root)
  if (full !== base && !full.startsWith(base + sep)) throw new Error('worktree 밖의 파일은 쓸 수 없습니다.')
  return full
}

export async function isRepo(cwd: string): Promise<boolean> {
  try {
    const out = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
    return out.trim() === 'true'
  } catch {
    return false
  }
}

/** 이동한 원본 저장소가 기존 linked worktree의 양쪽 포인터를 다시 쓰게 한다. */
export async function repairLinkedWorktrees(
  origin: string,
  worktreePaths: string[],
): Promise<{ ok: boolean; message: string }> {
  if (worktreePaths.length === 0) return { ok: true, message: '복구할 worktree가 없습니다.' }
  try {
    await gitWithError(origin, ['worktree', 'repair', ...worktreePaths])
    return { ok: true, message: `연결된 worktree ${worktreePaths.length}개를 복구했습니다.` }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Git worktree 연결 복구에 실패했습니다.',
    }
  }
}

/** 사용자가 승인한 Project Memory 정본만 커밋한다. 다른 staged/working 변경은 포함하지 않는다. */
export async function commitProjectMemory(cwd: string): Promise<{ ok: boolean; message: string }> {
  if (!(await isRepo(cwd))) return { ok: true, message: 'Git 저장소가 아니므로 파일만 저장했습니다.' }
  return serializeRepositoryMutation(cwd, async () => {
    const paths = ['AGENTS.md', 'CLAUDE.md']
    try {
      const changed = await git(cwd, ['status', '--porcelain', '--', ...paths])
      if (!changed.trim()) return { ok: true, message: '새로 커밋할 Memory 변경이 없습니다.' }
      await gitWithError(cwd, ['add', '--', ...paths])
      await gitWithError(cwd, [
        'commit',
        '--only',
        '-m',
        'docs: 프로젝트 Memory 갱신',
        '--',
        ...paths,
      ])
      return { ok: true, message: '승인한 Project Memory를 원본 브랜치에 커밋했습니다.' }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Project Memory 커밋에 실패했습니다.',
      }
    }
  })
}

export async function projectMemoryDirty(cwd: string): Promise<boolean> {
  if (!(await isRepo(cwd))) return false
  return git(cwd, ['status', '--porcelain', '--', 'AGENTS.md', 'CLAUDE.md'])
    .then((output) => output.trim().length > 0)
    .catch(() => true)
}

/** 세션 시작 전 상태 기록 (기획서 17장 Git Snapshot) */
export async function snapshot(cwd: string): Promise<GitSnapshot | undefined> {
  if (!(await isRepo(cwd))) return undefined
  try {
    const [branch, head, status] = await Promise.all([
      git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
      git(cwd, ['rev-parse', 'HEAD']).catch(() => ''),
      git(cwd, ['status', '--porcelain=v1']).catch(() => ''),
    ])

    const modified: string[] = []
    const untracked: string[] = []
    for (const line of status.split('\n')) {
      if (!line.trim()) continue
      const code = line.slice(0, 2)
      const path = line.slice(3).trim()
      if (code === '??') untracked.push(path)
      else modified.push(path)
    }

    return {
      branch: branch.trim(),
      head: head.trim().slice(0, 12),
      modified,
      untracked,
      takenAt: Date.now(),
    }
  } catch {
    return undefined
  }
}

/** 스냅샷 이후 변경된 파일 (세션이 실제로 바꾼 것 + 그 사이 외부 변경 포함) */
export async function changedSince(
  cwd: string,
  base: GitSnapshot,
): Promise<{ path: string; status: string }[]> {
  if (!(await isRepo(cwd))) return []
  try {
    const status = await git(cwd, ['status', '--porcelain=v1'])
    const before = new Set([...base.modified, ...base.untracked])
    const out: { path: string; status: string }[] = []
    for (const line of status.split('\n')) {
      if (!line.trim()) continue
      const code = line.slice(0, 2).trim()
      const path = line.slice(3).trim()
      if (!before.has(path)) out.push({ path, status: code || 'M' })
    }
    return out
  } catch {
    return []
  }
}

/** 단일 파일의 현재 작업 트리 diff */
export async function diffFile(cwd: string, path: string): Promise<string> {
  try {
    const tracked = await git(cwd, ['ls-files', '--error-unmatch', path])
      .then(() => true)
      .catch(() => false)
    if (!tracked) return `+++ ${path}\n(새 파일 — 아직 git 에 추가되지 않음)`
    return await git(cwd, ['diff', '--', path])
  } catch {
    return ''
  }
}

/**
 * 세션 전용 worktree.
 *
 * 여러 세션이 같은 작업 디렉토리를 공유하면 서로의 편집을 덮어쓴다. 지금까지는
 * 감지해서 경고만 했는데(checkConflict), worktree 로 나누면 애초에 부딪히지 않는다.
 *
 * 위치는 **저장소 밖**(앱 데이터 폴더)에 둔다. 저장소 안에 만들면 프로젝트마다
 * .gitignore 를 손대야 하고, 사용자 파일 목록을 오염시킨다.
 */
export async function addWorktree(
  cwd: string,
  dir: string,
  branch: string,
): Promise<Omit<SessionWorktree, 'origin'> | undefined> {
  try {
    const [baseBranch, baseHead] = await Promise.all([
      git(cwd, ['symbolic-ref', '--short', 'HEAD'])
        .then((out) => out.trim())
        .catch(() => ''),
      git(cwd, ['rev-parse', 'HEAD']).then((out) => out.trim()),
    ])
    // 기준은 현재 HEAD. 새 브랜치를 만들어 원래 브랜치를 건드리지 않는다.
    await git(cwd, ['worktree', 'add', '-b', branch, dir, 'HEAD'])
    return { path: dir, branch, ...(baseBranch ? { baseBranch } : {}), baseHead }
  } catch {
    return undefined
  }
}

/** 세션이 끝나거나 지워질 때 정리. 작업 내용이 남아 있으면 지우지 않는다. */
export async function removeWorktree(
  cwd: string,
  dir: string,
  branch?: string,
  force = false,
): Promise<WorktreeCleanupResult> {
  try {
    await gitWithError(cwd, ['worktree', 'remove', ...(force ? ['--force'] : []), dir])
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Git이 worktree를 제거하지 못했습니다.'
    return { ok: false, message: `worktree 폴더를 정리하지 못했습니다: ${detail}` }
  }

  if (!branch) return { ok: true, message: 'worktree 폴더를 정리했습니다.' }

  try {
    // -d는 원본에 병합됐거나 커밋이 없는 브랜치만 지운다. 미병합 작업은 보존한다.
    await gitWithError(cwd, ['branch', '-d', branch])
    return { ok: true, branchRemoved: true, message: 'worktree 폴더와 작업 브랜치를 정리했습니다.' }
  } catch {
    return {
      ok: true,
      branchRemoved: false,
      message: 'worktree 폴더를 정리했습니다. 미병합 작업이 있는 브랜치는 보존했습니다.',
    }
  }
}

/** worktree 안에서 커밋되지 않은 변경이 있는지 */
export async function worktreeDirty(dir: string): Promise<boolean | undefined> {
  try {
    return (await git(dir, ['status', '--porcelain'])).trim().length > 0
  } catch {
    return undefined
  }
}

/** 원래 브랜치 기준으로 worktree 브랜치가 몇 커밋 앞서 있는지 */
export async function worktreeAhead(cwd: string, branch: string, base: string): Promise<number> {
  try {
    const out = await git(cwd, ['rev-list', '--count', `${base}..${branch}`])
    return Number(out.trim()) || 0
  } catch {
    return 0
  }
}

/** worktree 브랜치의 현재 상태와 안전한 fast-forward 병합 가능 여부 */
export async function worktreeStatus(wt: SessionWorktree): Promise<WorktreeStatus> {
  const base = wt.baseBranch
  const blocked = (reason: string, partial: Partial<WorktreeStatus> = {}): WorktreeStatus => ({
    worktree: wt,
    baseBranch: base,
    dirty: false,
    originDirty: false,
    hasCommits: false,
    ahead: 0,
    behind: 0,
    merged: false,
    canMerge: false,
    reason,
    ...partial,
  })

  if (!base || !wt.baseHead) {
    return blocked('이 worktree에는 원본 브랜치 정보가 없어 자동 병합할 수 없습니다. 직접 병합해 주세요.')
  }

  const pendingConflicts = await unmergedFiles(wt.path)
  if (pendingConflicts.length > 0) {
    return blocked('원본 변경 반영 중 충돌 해결이 진행 중입니다.', {
      dirty: true,
      hasCommits: true,
      conflictFiles: pendingConflicts,
    })
  }

  try {
    const [currentBranch, worktreeBranch, worktreeHead, dirtyText, originDirtyText] = await Promise.all([
      git(wt.origin, ['symbolic-ref', '--short', 'HEAD']).then((out) => out.trim()),
      git(wt.path, ['symbolic-ref', '--short', 'HEAD']).then((out) => out.trim()),
      git(wt.path, ['rev-parse', 'HEAD']).then((out) => out.trim()),
      git(wt.path, ['status', '--porcelain']),
      git(wt.origin, ['status', '--porcelain']),
    ])

    if (worktreeBranch !== wt.branch) {
      return blocked('worktree가 앱이 만든 작업 브랜치와 다른 브랜치를 가리키고 있습니다.', {
        currentBranch,
      })
    }

    const [aheadText, behindText, baseHeadIsAncestor] = await Promise.all([
      git(wt.origin, ['rev-list', '--count', `${base}..${wt.branch}`]),
      git(wt.origin, ['rev-list', '--count', `${wt.branch}..${base}`]),
      git(wt.origin, ['merge-base', '--is-ancestor', wt.baseHead, worktreeHead])
        .then(() => true)
        .catch(() => false),
    ])
    const ahead = Number(aheadText.trim()) || 0
    const behind = Number(behindText.trim()) || 0
    const dirty = dirtyText.trim().length > 0
    const originDirty = originDirtyText.trim().length > 0
    const hasCommits = worktreeHead !== wt.baseHead
    const merged = hasCommits && ahead === 0
    const common = {
      currentBranch,
      dirty,
      originDirty,
      hasCommits,
      ahead,
      behind,
      merged,
    }

    if (!baseHeadIsAncestor) {
      return blocked('작업 브랜치의 기준 이력이 달라져 자동 병합할 수 없습니다.', common)
    }
    if (currentBranch !== base) {
      return blocked(`원본 프로젝트에서 ${base} 브랜치로 전환한 뒤 다시 시도해 주세요.`, common)
    }
    if (dirty) {
      return blocked('worktree에 커밋되지 않은 변경이 있습니다. 먼저 변경을 커밋해 주세요.', common)
    }
    if (originDirty) {
      return blocked('원본 프로젝트에 커밋되지 않은 변경이 있습니다. 먼저 정리해 주세요.', common)
    }
    if (!hasCommits) {
      return blocked('아직 원본에 반영할 worktree 커밋이 없습니다.', common)
    }
    if (merged) {
      return blocked('작업 브랜치의 커밋이 이미 원본 브랜치에 반영되어 있습니다.', common)
    }
    if (behind > 0) {
      return blocked('원본 브랜치와 작업 브랜치가 갈라져 fast-forward 병합할 수 없습니다.', common)
    }

    return {
      worktree: wt,
      baseBranch: base,
      ...common,
      canMerge: true,
    }
  } catch {
    return blocked('worktree 또는 원본 저장소의 Git 상태를 읽지 못했습니다.')
  }
}

/** worktree 생성 기준부터 현재 worktree HEAD/작업 트리까지의 전체 diff */
export async function worktreeDiff(wt: SessionWorktree): Promise<string> {
  if (!wt.baseHead) return '(기준 커밋을 알 수 없어 diff 를 만들 수 없습니다.)'

  try {
    const [committed, working, untrackedText] = await Promise.all([
      git(wt.path, ['diff', '--find-renames', `${wt.baseHead}..HEAD`]).catch(() => ''),
      git(wt.path, ['diff', '--find-renames', 'HEAD']).catch(() => ''),
      git(wt.path, ['ls-files', '--others', '--exclude-standard']).catch(() => ''),
    ])
    const untracked = untrackedText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    const parts: string[] = []
    if (committed.trim()) parts.push(committed.trimEnd())
    if (working.trim()) parts.push(`# 커밋되지 않은 tracked 변경\n${working.trimEnd()}`)
    if (untracked.length > 0) {
      parts.push(`# 새 파일 - 아직 git 에 추가되지 않음\n${untracked.map((p) => `+++ ${p}`).join('\n')}`)
    }

    return parts.join('\n\n') || '(변경 없음)'
  } catch {
    return '(worktree diff 를 읽지 못했습니다.)'
  }
}

/** worktree 의 현재 변경을 모두 stage 해서 작업 브랜치에 커밋한다. */
export async function commitWorktree(
  wt: SessionWorktree,
  message: string,
): Promise<WorktreeCommitResult> {
  return serializeRepositoryMutation(wt.origin, async () => {
    const title = message.trim()
    if (!title) return { ok: false, message: '커밋 메시지를 입력해 주세요.', status: await worktreeStatus(wt) }
    const subject = title.split(/\r?\n/, 1)[0]

    const before = await worktreeStatus(wt)
    if (!before.dirty) {
      return { ok: false, message: '커밋할 worktree 변경이 없습니다.', status: before }
    }

    try {
      await gitWithError(wt.path, ['add', '-A'])
      const staged = await git(wt.path, ['diff', '--cached', '--name-only'])
      if (!staged.trim()) {
        return { ok: false, message: '커밋할 변경을 찾지 못했습니다.', status: await worktreeStatus(wt) }
      }
      await gitWithError(wt.path, ['commit', '-m', title])
      const status = await worktreeStatus(wt)
      if (status.dirty) {
        return {
          ok: false,
          message: '커밋 후에도 worktree에 변경이 남아 있어 자동 반영을 중단했습니다.',
          status,
        }
      }
      return {
        ok: true,
        message: `worktree 변경을 커밋했습니다: ${subject}`,
        status,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'worktree 커밋에 실패했습니다.',
        status: await worktreeStatus(wt),
      }
    }
  })
}

/** worktree 브랜치를 현재 원본 브랜치 위로 재배치한다. 충돌은 해결 창에서 이어갈 수 있게 유지한다. */
export async function rebaseWorktree(
  wt: SessionWorktree,
  strategy?: WorktreeRebaseStrategy,
): Promise<WorktreeRebaseResult> {
  const before = await worktreeStatus(wt)
  if (before.dirty) {
    return { ok: false, message: 'worktree 변경을 먼저 커밋해 주세요.', status: before }
  }
  if (before.originDirty) {
    return { ok: false, message: '원본 프로젝트의 미커밋 변경을 먼저 정리해 주세요.', status: before }
  }
  if (!before.hasCommits) {
    return { ok: false, message: '재배치할 worktree 커밋이 없습니다.', status: before }
  }
  if (before.behind === 0) {
    return { ok: false, message: '이미 원본 브랜치 기준으로 최신 상태입니다.', status: before }
  }
  if (!wt.baseBranch) {
    return { ok: false, message: '원본 브랜치 정보가 없어 재배치할 수 없습니다.', status: before }
  }

  try {
    const strategyArgs = strategy === 'origin' ? ['-X', 'ours'] : strategy === 'worktree' ? ['-X', 'theirs'] : []
    await gitWithError(wt.path, ['rebase', ...strategyArgs, wt.baseBranch])
    const baseHead = await git(wt.origin, ['rev-parse', wt.baseBranch]).then((out) => out.trim())
    const nextWt = { ...wt, baseHead }
    const suffix =
      strategy === 'origin'
        ? ' 원본 파일을 우선했습니다.'
        : strategy === 'worktree'
          ? ' 이 세션의 파일을 우선했습니다.'
          : ''
    return {
      ok: true,
      message: `${wt.branch}를 ${wt.baseBranch} 최신 커밋 위로 재배치했습니다.${suffix}`,
      status: await worktreeStatus(nextWt),
    }
  } catch (error) {
    const conflictFiles = await git(wt.path, ['diff', '--name-only', '--diff-filter=U'])
      .then((out) =>
        out
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      )
      .catch(() => [])
    if (conflictFiles.length === 0 || strategy) {
      await gitWithError(wt.path, ['rebase', '--abort']).catch(() => undefined)
    }
    const message =
      conflictFiles.length > 0
        ? strategy
          ? `선택한 우선순위로 해결하지 못해 재배치를 취소했습니다. 충돌 파일: ${conflictFiles.join(', ')}`
          : `원본 변경 반영 중 충돌이 발생했습니다. 해결할 파일: ${conflictFiles.join(', ')}`
        : error instanceof Error
          ? error.message
          : '원본 변경 반영 중 충돌이 발생했습니다.'
    return {
      ok: false,
      message,
      conflictFiles,
      status: strategy ? await worktreeStatus(wt) : before,
    }
  }
}

function languageFromPath(path: string): string | undefined {
  const name = path.toLowerCase()
  if (name.endsWith('.tsx') || name.endsWith('.jsx')) return name.slice(-3)
  const ext = name.split('.').pop()
  return ext && ext !== name ? ext : undefined
}

async function showFile(cwd: string, ref: string, path: string): Promise<{ content: string; missing: boolean }> {
  try {
    return { content: await git(cwd, ['show', `${ref}:${path}`]), missing: false }
  } catch {
    return { content: '', missing: true }
  }
}

async function binaryDiff(cwd: string, args: string[]): Promise<boolean> {
  const out = await git(cwd, ['diff', '--numstat', ...args]).catch(() => '')
  return out.split('\n').some((line) => line.startsWith('-\t-\t'))
}

/** 충돌 판단에 쓸 원본/작업 브랜치 파일 내용을 나란히 읽는다. */
export async function worktreeConflictFile(
  wt: SessionWorktree,
  path: string,
): Promise<WorktreeConflictFile> {
  const base = wt.baseBranch ?? 'HEAD'
  const staged = await git(wt.path, ['ls-files', '-u', '--', path]).catch(() => '')
  const duringRebase = staged.trim().length > 0
  const [origin, worktree] = await Promise.all([
    duringRebase ? showFile(wt.path, ':2', path) : showFile(wt.origin, base, path),
    duringRebase ? showFile(wt.path, ':3', path) : showFile(wt.origin, wt.branch, path),
  ])
  const binary =
    origin.content.includes('\0') ||
    worktree.content.includes('\0') ||
    (duringRebase
      ? await binaryDiff(wt.path, ['--', path])
      : await binaryDiff(wt.origin, [base, wt.branch, '--', path]))

  return {
    path,
    originLabel: duringRebase ? `${base} (현재 rebase 원본)` : base,
    worktreeLabel: duringRebase ? `${wt.branch} (현재 적용 커밋)` : wt.branch,
    originContent: origin.content,
    worktreeContent: worktree.content,
    originMissing: origin.missing,
    worktreeMissing: worktree.missing,
    binary,
    language: languageFromPath(path),
  }
}

async function writeResolvedFile(root: string, file: WorktreeResolvedFile): Promise<void> {
  const full = safeWorktreePath(root, file.path)
  if (file.deleted) {
    await unlink(full).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    return
  }
  if (file.side) {
    await gitWithError(root, ['checkout', file.side === 'origin' ? '--ours' : '--theirs', '--', file.path])
    return
  }
  if (file.content === undefined) throw new Error(`${file.path}: 적용할 해결 내용이 없습니다.`)

  await mkdir(dirname(full), { recursive: true })
  const info = await lstat(full).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (info?.isSymbolicLink()) await unlink(full)
  await writeFile(full, file.content)
}

/** 선택한 충돌 결과를 파일에 쓰고 rebase 를 이어간다. 다음 충돌은 유지해 다시 선택받는다. */
export async function resolveWorktreeConflicts(
  wt: SessionWorktree,
  files: WorktreeResolvedFile[],
): Promise<WorktreeRebaseResult> {
  if (!wt.baseBranch) return { ok: false, message: '원본 브랜치 정보가 없어 충돌을 해결할 수 없습니다.' }
  if (files.length === 0) return { ok: false, message: '적용할 충돌 해결 파일이 없습니다.' }

  let currentConflicts = await unmergedFiles(wt.path)
  if (currentConflicts.length === 0) {
    try {
      await gitWithError(wt.path, ['rebase', wt.baseBranch])
      const baseHead = await git(wt.origin, ['rev-parse', wt.baseBranch]).then((out) => out.trim())
      return {
        ok: true,
        message: '이미 충돌 없이 원본 변경을 반영했습니다.',
        status: await worktreeStatus({ ...wt, baseHead }),
      }
    } catch (error) {
      currentConflicts = await unmergedFiles(wt.path)
      if (currentConflicts.length === 0) {
        await gitWithError(wt.path, ['rebase', '--abort']).catch(() => undefined)
        return {
          ok: false,
          message: error instanceof Error ? error.message : '충돌 해결을 위한 rebase를 시작하지 못했습니다.',
          status: await worktreeStatus(wt),
        }
      }
    }
  }

  const requested = [...new Set(files.map((file) => file.path))].sort()
  const expected = [...currentConflicts].sort()
  if (requested.length !== expected.length || requested.some((path, index) => path !== expected[index])) {
    return {
      ok: false,
      message: '충돌 단계가 변경되었습니다. 현재 충돌 파일을 다시 확인해 주세요.',
      conflictFiles: currentConflicts,
    }
  }

  try {
    for (const file of files) await writeResolvedFile(wt.path, file)
    await gitWithError(wt.path, ['add', '-A', '--', ...currentConflicts])
    await gitWithError(wt.path, ['rebase', '--continue'])
    const baseHead = await git(wt.origin, ['rev-parse', wt.baseBranch]).then((out) => out.trim())
    const nextWt = { ...wt, baseHead }
    return {
      ok: true,
      message: '선택한 내용으로 모든 충돌을 해결하고 원본 변경을 반영했습니다.',
      status: await worktreeStatus(nextWt),
    }
  } catch (error) {
    const conflictFiles = await unmergedFiles(wt.path)
    if (conflictFiles.length > 0) {
      return {
        ok: false,
        message: '다음 커밋에서 추가 충돌이 발생했습니다. 이어서 해결해 주세요.',
        conflictFiles,
      }
    }
    await gitWithError(wt.path, ['rebase', '--abort']).catch(() => undefined)
    return {
      ok: false,
      message: error instanceof Error ? error.message : '충돌 해결 적용에 실패했습니다.',
      status: await worktreeStatus(wt),
    }
  }
}

/** 충돌 해결 창을 닫았을 때 진행 중인 rebase를 원래 상태로 되돌린다. */
export async function abortWorktreeRebase(wt: SessionWorktree): Promise<boolean> {
  if ((await unmergedFiles(wt.path)).length === 0) return false
  await gitWithError(wt.path, ['rebase', '--abort']).catch(() => undefined)
  return true
}

/** 충돌 상태를 남기지 않는 fast-forward 병합만 수행한다. */
export async function mergeWorktree(wt: SessionWorktree): Promise<WorktreeMergeResult> {
  return serializeRepositoryMutation(wt.origin, async () => {
    const before = await worktreeStatus(wt)
    if (!before.canMerge) {
      return { ok: false, message: before.reason ?? '지금은 병합할 수 없습니다.', status: before }
    }

    try {
      await gitWithError(wt.origin, ['merge', '--ff-only', wt.branch])
      const status = await worktreeStatus(wt)
      if (!status.merged || status.dirty || status.originDirty) {
        return {
          ok: false,
          message: status.dirty
            ? '병합 후에도 worktree 변경이 남아 있어 완료로 처리하지 않았습니다.'
            : status.originDirty
              ? '병합 후 원본 저장소에 커밋되지 않은 변경이 있어 완료로 처리하지 않았습니다.'
              : '병합 결과를 확인하지 못해 완료로 처리하지 않았습니다.',
          status,
        }
      }
      return {
        ok: true,
        message: `${wt.branch}의 커밋을 ${wt.baseBranch}에 반영했습니다.`,
        status,
      }
    } catch (error) {
      const status = await worktreeStatus(wt)
      return {
        ok: false,
        message: error instanceof Error
          ? error.message
          : status.reason ?? '병합 직전에 저장소 상태가 바뀌어 작업을 중단했습니다.',
        status,
      }
    }
  })
}

/** worktree HEAD의 실제 커밋 시각. 알림이 오래된 성공 기록인지 구분할 때 사용한다. */
export async function worktreeHeadCommitTime(wt: SessionWorktree): Promise<number | undefined> {
  try {
    const value = (await git(wt.path, ['log', '-1', '--format=%cI'])).trim()
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : undefined
  } catch {
    return undefined
  }
}
