import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitSnapshot } from '@shared/session'

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
): Promise<{ path: string; branch: string } | undefined> {
  try {
    // 기준은 현재 HEAD. 새 브랜치를 만들어 원래 브랜치를 건드리지 않는다.
    await git(cwd, ['worktree', 'add', '-b', branch, dir, 'HEAD'])
    return { path: dir, branch }
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
