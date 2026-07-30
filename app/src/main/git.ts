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
