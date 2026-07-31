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
