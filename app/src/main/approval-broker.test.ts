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
    broker.attach('session-1', dir, true)
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

    broker.detach('session-1')
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })
})
