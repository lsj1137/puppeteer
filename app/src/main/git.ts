import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  GitSnapshot,
  SessionWorktree,
  WorktreeMergeResult,
  WorktreeStatus,
} from '@shared/session'

const exec = promisify(execFile)

/**
 * git 은 호스트(Windows)에서 실행한다.
 * WSL 프로젝트도 경로가 /mnt/c 로 매핑된 같은 디스크라 Windows git 으로 읽을 수 있고,
 * 러너를 거치지 않아 세션이 죽어도 스냅샷 조회가 가능하다.
 */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd,
    timeout: 20_000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

export async function isRepo(cwd: string): Promise<boolean> {
  try {
    const out = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
    return out.trim() === 'true'
  } catch {
    return false
  }
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
export async function removeWorktree(cwd: string, dir: string, force = false): Promise<boolean> {
  try {
    await git(cwd, ['worktree', 'remove', ...(force ? ['--force'] : []), dir])
    return true
  } catch {
    return false
  }
}

/** worktree 안에서 커밋되지 않은 변경이 있는지 */
export async function worktreeDirty(dir: string): Promise<boolean> {
  try {
    return (await git(dir, ['status', '--porcelain'])).trim().length > 0
  } catch {
    return false
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

/** 충돌 상태를 남기지 않는 fast-forward 병합만 수행한다. */
export async function mergeWorktree(wt: SessionWorktree): Promise<WorktreeMergeResult> {
  const before = await worktreeStatus(wt)
  if (!before.canMerge) {
    return { ok: false, message: before.reason ?? '지금은 병합할 수 없습니다.', status: before }
  }

  try {
    await git(wt.origin, ['merge', '--ff-only', wt.branch])
    const status = await worktreeStatus(wt)
    return {
      ok: true,
      message: `${wt.branch}의 커밋을 ${wt.baseBranch}에 반영했습니다.`,
      status,
    }
  } catch {
    const status = await worktreeStatus(wt)
    return {
      ok: false,
      message: status.reason ?? '병합 직전에 저장소 상태가 바뀌어 작업을 중단했습니다.',
      status,
    }
  }
}
