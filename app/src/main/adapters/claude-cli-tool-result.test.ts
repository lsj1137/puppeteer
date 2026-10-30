import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DetectedRunner, SessionEvent } from '@shared/session'
import { ClaudeCliAdapter, toolResultText } from './claude-cli'

/**
 * 실제 사고: 정상 종료한 Bash 가 stderr 에 «Shell cwd was reset to …» 가 붙었다는 이유로 «실패» 로
 * 찍혔다(열흘치 1,772건 중 927건). 진짜 실패는 결과가 문자열로 와서 아예 표시되지 않았다.
 * 아래 이벤트 모양은 CLI 2.1.284 실측 그대로다.
 */
const EVENTS = [
  { type: 'system', subtype: 'init', session_id: 's1', tools: [] },
  {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'out' }] },
    tool_use_result: { stdout: 'out', stderr: 'Shell cwd was reset to /mnt/d/x', interrupted: false },
  },
  {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'Exit code 3\nout2' }] },
    tool_use_result: 'Error: Exit code 3\nout2',
  },
  { type: 'result', is_error: false, result: 'done', usage: {}, total_cost_usd: 0 },
]

function fakeCli(): DetectedRunner {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-tool-'))
  const script = join(dir, 'fake.mjs')
  writeFileSync(
    script,
    `process.stdin.resume()
process.stdin.on('end', () => {
  for (const e of ${JSON.stringify(EVENTS)}) process.stdout.write(JSON.stringify(e) + '\\n')
  process.exit(0)
})
`,
  )
  return {
    id: 'custom:fake',
    kind: 'custom',
    provider: 'claude-cli',
    executable: process.execPath,
    executableArgs: [script],
    installMethod: 'unknown',
    available: true,
  }
}

describe('도구 결과 성공/실패 판정', () => {
  it('stderr 가 있어도 is_error 가 false 면 성공, 문자열로 온 실패도 실패로 표시한다', async () => {
    const results = await new Promise<Array<{ id: string; ok: boolean; preview: string }>>((resolve) => {
      const out: Array<{ id: string; ok: boolean; preview: string }> = []
      const adapter = new ClaudeCliAdapter((event: SessionEvent) => {
        if (event.t === 'tool-result') out.push({ id: event.toolUseId, ok: event.ok, preview: event.preview })
        if (event.t === 'status' && event.status === 'completed') resolve(out)
      })
      adapter.start({ runner: fakeCli(), cwd: tmpdir(), prompt: 'hi' })
    })

    expect(results).toEqual([
      { id: 't1', ok: true, preview: 'out\nShell cwd was reset to /mnt/d/x' },
      { id: 't2', ok: false, preview: 'Error: Exit code 3\nout2' },
    ])
  })
})

describe('toolResultText', () => {
  it('문자열과 text 조각 배열을 모두 읽는다', () => {
    expect(toolResultText({ content: 'a' })).toBe('a')
    expect(toolResultText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a\nb')
    expect(toolResultText(undefined)).toBe('')
  })
})
