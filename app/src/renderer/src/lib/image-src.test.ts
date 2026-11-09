import { describe, expect, it } from 'vitest'
import { classifyImage } from './image-src'

describe('classifyImage', () => {
  it('외부 주소는 눌러야 불러오도록 remote 로 가린다', () => {
    expect(classifyImage('https://example.com/a.png')).toEqual({ kind: 'remote', url: 'https://example.com/a.png', host: 'example.com' })
  })

  it('로컬 경로는 앱 전용 통로로 바꾸고 작업 폴더를 함께 넘긴다', () => {
    const s = classifyImage('C:\\proj\\chart.png', 'C:\\proj')
    expect(s.kind).toBe('local')
    if (s.kind !== 'local') return
    const url = new URL(s.url)
    expect(url.protocol).toBe('pp-image:')
    expect(url.searchParams.get('path')).toBe('C:\\proj\\chart.png')
    expect(url.searchParams.get('base')).toBe('C:\\proj')
    expect(classifyImage('/tmp/a.png').kind).toBe('local')
  })

  // 실측: react-markdown 은 `![a](<C:\\Users\\x y\\p.png>)` 의 주소를 퍼센트 인코딩해 넘긴다.
  it('퍼센트 인코딩된 Windows 경로도 풀어서 로컬로 본다', () => {
    const s = classifyImage('C:%5CUsers%5Cx%20y%5Cp.png')
    expect(s).toMatchObject({ kind: 'local', path: 'C:\\Users\\x y\\p.png' })
  })

  it('data:image 는 그대로, javascript: 같은 스킴은 그리지 않는다', () => {
    expect(classifyImage('data:image/png;base64,AAAA').kind).toBe('inline')
    expect(classifyImage('javascript:alert(1)').kind).toBe('invalid')
    expect(classifyImage('').kind).toBe('invalid')
  })
})
