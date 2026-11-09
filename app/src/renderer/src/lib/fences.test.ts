import { describe, expect, it } from 'vitest'
import { INLINE_MAX_LINES, splitFences } from './fences'

const longBody = Array.from({ length: INLINE_MAX_LINES + 1 }, (_, i) => `line ${i + 1}`).join('\n')

describe('splitFences', () => {
  it('extracts long code fences into artifacts', () => {
    const out = splitFences(`before\n\n\`\`\`ts:src/a.ts\n${longBody}\n\`\`\`\nafter`, 'm1')

    expect(out.artifacts).toEqual([
      {
        id: 'm1-a0',
        kind: 'code',
        language: 'ts',
        path: 'src/a.ts',
        content: longBody,
      },
    ])
    expect(out.segments).toEqual([
      { type: 'md', text: 'before\n' },
      { type: 'artifact', artifactId: 'm1-a0' },
      { type: 'md', text: 'after' },
    ])
  })

  it('classifies markdown and diff fences', () => {
    expect(splitFences(`\`\`\`md\n${longBody}\n\`\`\``, 'md').artifacts[0].kind).toBe('md')
    expect(splitFences(`\`\`\`diff\n${longBody}\n\`\`\``, 'diff').artifacts[0].kind).toBe('diff')
  })

  it('leaves short fences in the markdown stream', () => {
    const out = splitFences('```ts\nconst a = 1\n```', 'm2')

    expect(out.artifacts).toEqual([])
    expect(out.segments).toEqual([{ type: 'md', text: '```ts\nconst a = 1\n```' }])
  })
})

describe('그림 블록', () => {
  it('mermaid·svg 는 길어도 Artifact 로 빼지 않고 대화에 남긴다', () => {
    const body = ['flowchart TD', 'A-->B', 'B-->C', 'C-->D', 'D-->E', 'E-->F', 'F-->G'].join('\n')
    const { segments, artifacts } = splitFences(`설명\n\`\`\`mermaid\n${body}\n\`\`\``, 'k')
    expect(artifacts).toEqual([])
    expect(segments.every((segment) => segment.type === 'md')).toBe(true)
    expect(segments.map((segment) => (segment.type === 'md' ? segment.text : '')).join('\n')).toContain('```mermaid')
  })
})
