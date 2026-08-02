import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = join(import.meta.dirname, '..')
const userData = await mkdtemp(join(tmpdir(), 'agent-workspace-smoke-'))

delete process.env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, [root], {
  cwd: root,
  env: {
    ...process.env,
    AGENT_WORKSPACE_SMOKE: '1',
    AGENT_WORKSPACE_SMOKE_USER_DATA: userData,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
let settled = false
let payload
const timer = setTimeout(() => {
  fail(new Error(payload ? 'Timed out waiting for Electron to exit' : 'Timed out waiting for Electron smoke marker'))
}, 20_000)

child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  output += chunk
  checkOutput()
})
child.stderr.on('data', (chunk) => {
  output += chunk
  checkOutput()
})
child.on('error', fail)
child.on('exit', (code) => {
  if (settled) return
  if (code !== 0) {
    fail(new Error(`Electron exited with ${code ?? 'unknown'}`))
    return
  }
  if (!payload) {
    fail(new Error('Electron exited before smoke marker'))
    return
  }
  pass(payload)
})

function checkOutput() {
  if (payload) return
  const line = output.split(/\r?\n/).find((l) => l.startsWith('AGENT_WORKSPACE_SMOKE '))
  if (!line) return
  const nextPayload = JSON.parse(line.slice('AGENT_WORKSPACE_SMOKE '.length))
  if (!nextPayload.ok) {
    fail(new Error(nextPayload.error ?? 'Electron smoke failed'))
    return
  }
  payload = nextPayload
}

function pass(payload) {
  if (settled) return
  settled = true
  clearTimeout(timer)
  console.log(`Electron smoke passed (${payload.runners.length} runner(s) detected)`)
  cleanup().finally(() => process.exit(0))
}

function fail(error) {
  if (settled) return
  settled = true
  clearTimeout(timer)
  if (child.exitCode === null) child.kill()
  console.error(error.message)
  if (output.trim()) console.error(output.trim())
  cleanup().finally(() => process.exit(1))
}

async function cleanup() {
  await rm(userData, { recursive: true, force: true })
}
