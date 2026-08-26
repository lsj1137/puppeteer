import { describe, expect, it } from 'vitest'
import {
  applyLayoutPreference,
  parseLayoutPreference,
  resolveLayoutMode,
  PORTRAIT_ENTER_RATIO,
  PORTRAIT_EXIT_RATIO,
} from './layout-mode'

describe('resolveLayoutMode', () => {
  it('명확히 넓으면 가로', () => {
    expect(resolveLayoutMode(1440, 900)).toBe('landscape')
  })

  it('명확히 높으면 세로', () => {
    expect(resolveLayoutMode(900, 1440)).toBe('portrait')
  })

  it('진입 임계값에 닿으면 세로로 바꾼다', () => {
    expect(resolveLayoutMode(1000, 1000 * PORTRAIT_ENTER_RATIO, 'landscape')).toBe('portrait')
  })

  it('복귀 임계값에 닿으면 가로로 돌린다', () => {
    expect(resolveLayoutMode(1000, 1000 * PORTRAIT_EXIT_RATIO, 'portrait')).toBe('landscape')
  })

  describe('임계값 사이 구간', () => {
    // 정사각에 가까운 창을 드래그하는 동안 배치가 떨리지 않아야 한다.
    const square = { width: 1000, height: 1000 }

    it('가로였으면 가로를 유지한다', () => {
      expect(resolveLayoutMode(square.width, square.height, 'landscape')).toBe('landscape')
    })

    it('세로였으면 세로를 유지한다', () => {
      expect(resolveLayoutMode(square.width, square.height, 'portrait')).toBe('portrait')
    })

    it('한 번 세로로 들어가면 진입 임계값 아래로 조금 내려와도 버틴다', () => {
      const entered = resolveLayoutMode(1000, 1060, 'landscape')
      expect(entered).toBe('portrait')
      expect(resolveLayoutMode(1000, 1010, entered)).toBe('portrait')
      // 복귀 임계값까지 내려와야 비로소 가로로 돌아온다
      expect(resolveLayoutMode(1000, 940, entered)).toBe('landscape')
    })
  })

  it('크기가 0이면 직전 배치를 지킨다', () => {
    expect(resolveLayoutMode(0, 0, 'portrait')).toBe('portrait')
    expect(resolveLayoutMode(1200, 0, 'landscape')).toBe('landscape')
  })

  it('직전 배치를 넘기지 않으면 가로에서 시작한다', () => {
    expect(resolveLayoutMode(1000, 1000)).toBe('landscape')
  })
})

describe('applyLayoutPreference', () => {
  it('auto 는 창 비율을 따른다', () => {
    expect(applyLayoutPreference('auto', 'portrait')).toBe('portrait')
    expect(applyLayoutPreference('auto', 'landscape')).toBe('landscape')
  })

  it('고정하면 창 비율을 무시한다', () => {
    expect(applyLayoutPreference('landscape', 'portrait')).toBe('landscape')
    expect(applyLayoutPreference('portrait', 'landscape')).toBe('portrait')
  })
})

describe('parseLayoutPreference', () => {
  it('아는 값은 그대로 쓴다', () => {
    expect(parseLayoutPreference('portrait')).toBe('portrait')
    expect(parseLayoutPreference('landscape')).toBe('landscape')
    expect(parseLayoutPreference('auto')).toBe('auto')
  })

  it('없거나 모르는 값은 auto 로 떨어진다', () => {
    expect(parseLayoutPreference(null)).toBe('auto')
    expect(parseLayoutPreference('')).toBe('auto')
    expect(parseLayoutPreference('vertical')).toBe('auto')
  })
})
