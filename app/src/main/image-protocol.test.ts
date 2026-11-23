import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { candidatePaths, handleImageRequest, imageMime, isInside } from './image-protocol'

describe('candidatePaths', () => {
  it('Windows·file:// 경로는 그대로, WSL /mnt/<드라이브> 는 드라이브 경로로 바꾼다', () => {
    expect(candidatePaths('C:/work/chart.png', undefined, [], 'win32')).toEqual(['C:\\work\\chart.png'])
    expect(candidatePaths('file:///C:/work/a%20b.png', undefined, [], 'win32')).toEqual(['C:\\work\\a b.png'])
    expect(candidatePaths('/mnt/d/ITHR_WORKSPACE/out.png', undefined, [], 'win32')).toEqual(['D:\\ITHR_WORKSPACE\\out.png'])
  })

  it('WSL 의 /tmp 같은 경로는 배포판마다 후보를 만든다', () => {
    expect(candidatePaths('/tmp/chart.png', undefined, ['Ubuntu'], 'win32')).toEqual(['\\\\wsl.localhost\\Ubuntu\\tmp\\chart.png'])
  })

  it('상대 경로는 작업 폴더(base) 기준으로 푼다. base 가 WSL 경로여도 된다', () => {
    expect(candidatePaths('out/chart.png', 'C:\\proj', [], 'win32')).toEqual(['C:\\proj\\out\\chart.png'])
    expect(candidatePaths('chart.png', '/mnt/c/proj', [], 'win32')).toEqual(['C:\\proj\\chart.png'])
    expect(candidatePaths('chart.png', undefined, [], 'win32')).toEqual([])
  })
})

describe('isInside', () => {
  it('허용 폴더 안만 통과한다. 대소문자·구분자 차이는 무시한다', () => {
    expect(isInside('C:\\Proj\\out\\a.png', ['c:/proj'], 'win32')).toBe(true)
    expect(isInside('C:\\proj2\\a.png', ['C:\\proj'], 'win32')).toBe(false)
  })

  it('.. 로 빠져나가는 경로는 정규화 뒤에 막힌다', () => {
    const [p] = candidatePaths('..\\..\\Windows\\win.png', 'C:\\proj\\sub', [], 'win32')
    expect(p).toBe('C:\\Windows\\win.png')
    expect(isInside(p, ['C:\\proj'], 'win32')).toBe(false)
  })
})

describe('macOS·Linux 경로', () => {
  // v0.5.0 릴리스 실패: Windows 기준으로만 풀어 macOS 의 /var/… 임시 폴더를 WSL 경로로 바꿨다.
  it('/… 는 그 경로 그대로, 상대 경로는 작업 폴더 기준이다', () => {
    expect(candidatePaths('/var/folders/x/a.png', undefined, ['Ubuntu'], 'darwin')).toEqual(['/var/folders/x/a.png'])
    expect(candidatePaths('file:///Users/me/a.png', undefined, [], 'darwin')).toEqual(['/Users/me/a.png'])
    expect(candidatePaths('out/a.png', '/Users/me/proj', [], 'linux')).toEqual(['/Users/me/proj/out/a.png'])
    expect(candidatePaths('a.png', undefined, [], 'darwin')).toEqual([])
  })

  it('대소문자를 가려 비교하고 .. 탈출을 막는다', () => {
    expect(isInside('/Users/me/proj/a.png', ['/Users/me/proj'], 'darwin')).toBe(true)
    expect(isInside('/Users/me/Proj/a.png', ['/Users/me/proj'], 'linux')).toBe(false)
    const [p] = candidatePaths('../../etc/a.png', '/Users/me/proj', [], 'darwin')
    expect(isInside(p, ['/Users/me/proj'], 'darwin')).toBe(false)
  })
})

describe('handleImageRequest', () => {
  const root = mkdtempSync(join(tmpdir(), 'pp-image-'))
  writeFileSync(join(root, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(root, 'secret.txt'), 'nope')
  const access = { roots: () => [root], distros: async () => [] }
  const req = (path: string): Request => new Request(`pp-image://local/?${new URLSearchParams({ path })}`)

  it('허용 폴더 안 이미지는 MIME 과 함께 돌려준다', async () => {
    const res = await handleImageRequest(req(join(root, 'a.png')), access)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
  })

  it('이미지가 아닌 파일·허용 폴더 밖은 읽지 않는다', async () => {
    expect((await handleImageRequest(req(join(root, 'secret.txt')), access)).status).toBe(415)
    expect((await handleImageRequest(req('C:\\Windows\\System32\\x.png'), access)).status).toBe(404)
  })

  it('확장자로 MIME 을 고른다', () => {
    expect(imageMime('a.SVG')).toBe('image/svg+xml')
    expect(imageMime('a.exe')).toBeUndefined()
  })
})
