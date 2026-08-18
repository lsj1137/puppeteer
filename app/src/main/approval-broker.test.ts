import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ApprovalBroker, assessRisk } from './approval-broker'

describe('assessRisk', () => {
  it('treats shell execution as high risk', () => {
    expect(assessRisk('Bash', { command: 'npm install' }, '/tmp/project')).toBe('high')
    expect(assessRisk('PowerShell', { command: 'npm install' }, '/tmp/project')).toBe('high')
  })

  it('allows writes inside the project as medium risk', () => {
    expect(assessRisk('Write', { file_path: '/tmp/project/src/a.ts' }, '/tmp/project')).toBe('med')
    expect(assessRisk('Edit', { file_path: 'src/a.ts' }, '/tmp/project')).toBe('med')
  })

  it('does not confuse sibling directories with project children', () => {
    expect(assessRisk('Write', { file_path: '/tmp/project-other/a.ts' }, '/tmp/project')).toBe('high')
  })
})

describe('session approval mode', () => {
  it('automatically approves tool requests only while the session mode is enabled', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'puppeteer-auto-approval-'))
    const onRequest = vi.fn()
    const broker = new ApprovalBroker(onRequest)
    broker.attach('session-1:lead', 'session-1', dir, true)
    writeFileSync(join(dir, 'request.req.json'), JSON.stringify({
      tool_name: 'Bash', tool_input: { command: 'echo ok' }, cwd: dir,
    }))

    await vi.advanceTimersByTimeAsync(250)

    expect(onRequest).not.toHaveBeenCalled()
    const response = JSON.parse(readFileSync(join(dir, 'request.res.json'), 'utf8'))
    expect(response.hookSpecificOutput.permissionDecision).toBe('allow')

    broker.setAutoApprove('session-1', false)
    writeFileSync(join(dir, 'second.req.json'), JSON.stringify({
      tool_name: 'Bash', tool_input: { command: 'echo ask' }, cwd: dir,
    }))
    await vi.advanceTimersByTimeAsync(250)
    expect(onRequest).toHaveBeenCalledTimes(1)

    broker.detach('session-1:lead')
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  // 승인 정책은 세션 단위다. Lead 만 자동 승인되고 보조가 매번 묻는 상태가 되면 안 된다.
  it('세션의 모든 run 에 자동 승인을 함께 적용한다', async () => {
    vi.useFakeTimers()
    const root = mkdtempSync(join(tmpdir(), 'puppeteer-run-approval-'))
    const leadDir = join(root, 'lead')
    const subDir = join(root, 'sub')
    const onRequest = vi.fn()
    const broker = new ApprovalBroker(onRequest)
    broker.attach('session-1:lead', 'session-1', leadDir)
    broker.attach('run-sub', 'session-1', subDir)

    broker.setAutoApprove('session-1', true)
    for (const dir of [leadDir, subDir]) {
      writeFileSync(join(dir, 'request.req.json'), JSON.stringify({
        tool_name: 'Bash', tool_input: { command: 'echo ok' }, cwd: dir,
      }))
    }
    await vi.advanceTimersByTimeAsync(250)

    expect(onRequest).not.toHaveBeenCalled()
    for (const dir of [leadDir, subDir]) {
      const response = JSON.parse(readFileSync(join(dir, 'request.res.json'), 'utf8'))
      expect(response.hookSpecificOutput.permissionDecision).toBe('allow')
    }

    broker.detachSession('session-1')
    vi.useRealTimers()
    rmSync(root, { recursive: true, force: true })
  })

  it('요청에 어느 run 이 냈는지를 함께 싣는다', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'puppeteer-run-id-'))
    const onRequest = vi.fn()
    const broker = new ApprovalBroker(onRequest)
    broker.attach('run-sub', 'session-9', dir)
    writeFileSync(join(dir, 'request.req.json'), JSON.stringify({
      tool_name: 'Bash', tool_input: { command: 'echo ask' }, cwd: dir,
    }))

    await vi.advanceTimersByTimeAsync(250)

    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-9', runId: 'run-sub' }),
    )

    broker.detachSession('session-9')
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })
})
