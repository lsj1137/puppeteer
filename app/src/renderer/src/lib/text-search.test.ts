import { describe, expect, it } from 'vitest'
import { filterNumbered, highlightParts, matchOffsets } from './text-search'

describe('matchOffsets', () => {
  it('대소문자를 가리지 않고 겹치지 않게 모두 찾는다', () => {
    expect(matchOffsets('Ollama ollama OLLAMA', 'ollama')).toEqual([0, 7, 14])
    expect(matchOffsets('aaaa', 'aa')).toEqual([0, 2])
  })

  it('한글도 그대로 찾고, 앞뒤 공백만 있는 검색어는 없는 것으로 본다', () => {
    expect(matchOffsets('사용량 패널의 사용량', '사용량')).toEqual([0, 8])
    expect(matchOffsets('무엇이든', '   ')).toEqual([])
    expect(matchOffsets('앞 사용량 뒤', ' 사용량 ')).toEqual([2])
  })

  it('소문자로 바꾸면 길이가 달라지는 글이면 대소문자를 가려 찾는다(위치가 어긋나지 않게)', () => {
    const text = 'İstanbul ist'
    expect(matchOffsets(text, 'ist')).toEqual([9])
  })
})

describe('highlightParts', () => {
  it('일치한 조각은 원문 대소문자를 그대로 살린다', () => {
    expect(highlightParts('Use CTRL+F or ctrl+f', 'ctrl+f')).toEqual([
      { text: 'Use ', match: false },
      { text: 'CTRL+F', match: true },
      { text: ' or ', match: false },
      { text: 'ctrl+f', match: true },
    ])
  })

  it('일치가 없으면 통째로 돌려준다', () => {
    expect(highlightParts('없음', '있음')).toEqual([{ text: '없음', match: false }])
  })
})

describe('filterNumbered', () => {
  const items = [{ text: 'Ollama 붙여줘' }, { text: '사용량 고쳐' }, { text: 'ollama 설치했어' }]

  it('걸러도 원래 순번을 유지한다', () => {
    expect(filterNumbered(items, 'OLLAMA').map(({ number }) => number)).toEqual([1, 3])
  })

  it('검색어가 비면 전부 돌려준다', () => {
    expect(filterNumbered(items, '').map(({ number }) => number)).toEqual([1, 2, 3])
  })
})
