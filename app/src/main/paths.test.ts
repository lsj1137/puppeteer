import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/user-data' } }))

const { approvalDirOf, pathSegment } = await import('./paths')

describe('pathSegment', () => {
  it('run id 의 콜론을 지운다 — Windows 경로에 쓸 수 없다', () => {
    expect(pathSegment('2bcedf79-8f0e:lead')).toBe('2bcedf79-8f0e-lead')
    expect(pathSegment('2bcedf79:sub:a1b2c3d4')).toBe('2bcedf79-sub-a1b2c3d4')
  })

  it('평범한 id 는 그대로 둔다', () => {
    expect(pathSegment('2bcedf79-8f0e-4dc8-8f54-06ea78e91fe6')).toBe(
      '2bcedf79-8f0e-4dc8-8f54-06ea78e91fe6',
    )
  })
})

describe('approvalDirOf', () => {
  it('경로 어느 구간에도 예약 문자가 남지 않는다', () => {
    const dir = approvalDirOf('sess-1', 'sess-1:lead')
    expect(dir.replace(/^\/|^[A-Za-z]:/, '')).not.toContain(':')
    expect(dir.endsWith('sess-1-lead')).toBe(true)
  })

  // 보안 가상 드라이브에서 WSL 이 쓴 요청 파일이 사라져 승인이 끊겼다(2026-10-22, X:).
  it('프로젝트 폴더가 아니라 앱 데이터 폴더에 둔다', () => {
    const dir = approvalDirOf('sess-1', 'sess-1:lead')
    expect(dir.replace(/\\/g, '/')).toBe('/user-data/approvals/sess-1/sess-1-lead')
  })
})
