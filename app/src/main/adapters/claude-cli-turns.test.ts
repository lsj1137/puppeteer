import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DetectedRunner, SessionEvent } from '@shared/session'
import { ClaudeCliAdapter } from './claude-cli'

/**
 * 실제 사고(2026-10): CLI 가 한 프로세스에서 턴을 여러 번 돌리는데 앱이 첫 `result` 에서
 * 완료로 처리했다. 가짜 CLI 로 «턴 → (백그라운드 대기) → 스스로 다음 턴 → 종료» 를 재현한다.
 */
function fakeCli(gapMs: number, exitCode = 0): DetectedRunner {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'))
  const script = join(dir, 'fake.mjs')
  writeFileSync(
    script,
    `
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
process.stdin.resume()
process.stdin.on('end', async () => {
  out({ type: 'system', subtype: 'init', session_id: 's1', tools: [] })
  out({ type: 'result', is_error: false, result: '첫 턴', usage: {}, total_cost_usd: 0.1 })
  await sleep(${gapMs})
  out({ type: 'system', subtype: 'init', session_id: 's1', tools: [] })
  out({ type: 'result', is_error: false, result: '둘째 턴', usage: {}, total_cost_usd: 0.2 })
  process.exit(${exitCode})
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

function run(runner: DetectedRunner): Promise<Array<{ status: string; reason?: string }>> {
  return new Promise((resolve) => {
    const statuses: Array<{ status: string; reason?: string }> = []
    const adapter = new ClaudeCliAdapter((event: SessionEvent) => {
      if (event.t !== 'status') return
      statuses.push({ status: event.status, reason: event.reason })
      if (['completed', 'failed', 'stopped', 'auth-required'].includes(event.status)) resolve(statuses)
    })
    adapter.start({ runner, cwd: tmpdir(), prompt: 'hi' })
  })
}

describe('한 프로세스 여러 턴', () => {
  it('첫 result 에서 완료로 처리하지 않고, 프로세스가 끝날 때 마지막 결과로 완료한다', async () => {
    const statuses = await run(fakeCli(200))
    const terminal = statuses.filter((s) => s.status === 'completed')
    expect(terminal).toHaveLength(1)
    expect(terminal[0].reason).toBe('둘째 턴')
    // 완료는 맨 마지막 한 번뿐이다 — 그 앞에 다음 턴의 running 이 있다.
    expect(statuses.map((s) => s.status)).toEqual(['starting', 'running', 'running', 'completed'])
  })

  it('턴이 끝났는데 프로세스가 살아 있으면 «백그라운드 작업 중» 을 거쳐 다시 실행 중이 된다', async () => {
    const statuses = await run(fakeCli(3_600))
    expect(statuses.map((s) => s.status)).toEqual(['starting', 'running', 'background', 'running', 'completed'])
  }, 15_000)

  it('결과는 성공이어도 프로세스가 실패로 끝나면 실패다', async () => {
    const statuses = await run(fakeCli(50, 3))
    expect(statuses.at(-1)?.status).toBe('failed')
  })
})
