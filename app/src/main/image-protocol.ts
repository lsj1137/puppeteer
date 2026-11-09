import { realpathSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, win32 } from 'node:path'

/**
 * 대화에 붙는 로컬 이미지(`![설명](경로)`)를 화면에 보여주는 앱 전용 통로 `pp-image://`.
 *
 * 렌더러는 파일을 직접 못 읽고, `file://` 을 열어 두면 아무 파일이나 읽힌다. 그래서
 * - **이미지 확장자만**, **허용 폴더(프로젝트·앱 데이터(worktree 포함)·임시 폴더) 안에서만** 읽는다.
 * - 모델은 WSL 에서 돌면 `/mnt/c/...`·`/tmp/...` 처럼 쓴다. Windows 경로로 바꿔서 찾는다.
 * - 상대 경로는 렌더러가 넘긴 작업 폴더(base) 기준으로 푼다.
 */
export const IMAGE_SCHEME = 'pp-image'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

const MAX_BYTES = 25 * 1024 * 1024

export function imageMime(path: string): string | undefined {
  return MIME[extname(path).toLowerCase()]
}

/** 모델이 쓴 경로를 Windows 에서 열 수 있는 후보 경로로 바꾼다. WSL 홈·/tmp 는 배포판마다 후보가 생긴다. */
export function candidatePaths(raw: string, base: string | undefined, distros: string[]): string[] {
  let p = raw.trim()
  if (!p) return []
  try {
    p = decodeURI(p)
  } catch {
    // 이미 풀린 경로
  }
  p = p.replace(/^file:\/\/\/?/i, '')

  if (/^[A-Za-z]:[\\/]/.test(p)) return [win32.normalize(p)]
  const mnt = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(p)
  if (mnt) return [win32.normalize(`${mnt[1].toUpperCase()}:${(mnt[2] ?? '/').replace(/\//g, '\\')}`)]
  if (p.startsWith('\\\\')) return [win32.normalize(p)]
  if (p.startsWith('/')) return distros.map((distro) => win32.normalize(`\\\\wsl.localhost\\${distro}${p.replace(/\//g, '\\')}`))
  if (!base) return []
  // 상대 경로: base 도 WSL 경로일 수 있다.
  return candidatePaths(base, undefined, distros).map((root) => win32.resolve(root, p))
}

function key(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
}

export function isInside(path: string, roots: string[]): boolean {
  const target = key(path)
  return roots.some((root) => {
    const r = key(root)
    return target === r || target.startsWith(`${r}\\`)
  })
}

export interface ImageAccess {
  /** 허용 폴더 */
  roots: (distros: string[]) => string[]
  /**
   * 알려진 WSL 배포판. 대화 이미지는 앱을 켜자마자(실행환경 탐지 전) 그려질 수 있어서,
   * 모르면 그 자리에서 조회한다 — 안 그러면 `/tmp/…` 이미지가 «못 찾음» 으로 굳는다(실측).
   */
  distros: () => Promise<string[]>
}

/** 기본 허용 폴더: 등록 프로젝트 + 앱 데이터(worktree 포함) + Windows·WSL 임시 폴더 */
export function defaultRoots(projects: string[], userData: string, distros: string[]): string[] {
  return [
    ...projects,
    userData,
    tmpdir(),
    ...distros.map((distro) => `\\\\wsl.localhost\\${distro}\\tmp`),
  ]
}

/**
 * 실제 경로. Windows 임시 폴더는 `C:\Users\ADMINI~1\…` 처럼 짧은 이름으로 잡혀, 같은 폴더인데
 * 긴 이름 경로와 비교하면 «밖» 으로 나왔다(실측). 심볼릭 링크·junction 으로 밖을 가리키는 것도 이걸로 막는다.
 */
function real(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

export async function handleImageRequest(request: Request, access: ImageAccess): Promise<Response> {
  const url = new URL(request.url)
  const raw = url.searchParams.get('path') ?? ''
  const base = url.searchParams.get('base') ?? undefined
  const distros = await access.distros()
  const roots = access.roots(distros).flatMap((root) => [root, real(root)])

  for (const candidate of candidatePaths(raw, base, distros)) {
    const mime = imageMime(candidate)
    if (!mime) return new Response('이미지 파일이 아닙니다.', { status: 415 })
    let resolved: string
    try {
      resolved = await realpath(candidate)
    } catch {
      continue
    }
    if (!isInside(resolved, roots)) continue
    try {
      const info = await stat(resolved)
      if (!info.isFile()) continue
      if (info.size > MAX_BYTES) return new Response('이미지가 너무 큽니다.', { status: 413 })
      return new Response(await readFile(resolved), { headers: { 'content-type': mime } })
    } catch {
      // 다음 후보
    }
  }
  return new Response('허용 폴더 안에서 이미지를 찾지 못했습니다.', { status: 404 })
}
