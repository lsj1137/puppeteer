import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = join(import.meta.dirname, '..')
const temp = await mkdtemp(join(tmpdir(), 'puppeteer-e2e-'))
const userData = join(temp, 'user-data')
const project = join(temp, 'project')
const fakeCli = join(root, 'scripts', 'fake-claude-cli.mjs')
const wrapper = join(temp, process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude')

await writeFile(join(temp, '.keep'), '')
await writeFile(
  wrapper,
  process.platform === 'win32'
    // 실제 CLI 인자에는 hook JSON과 `|`가 들어 있다. `%*`로 다시 펼치면 cmd.exe가
    // 이를 셸 문법으로 재해석한다. 가짜 CLI는 인자가 필요 없으므로 전달하지 않는다.
    ? `@"${process.execPath}" "${fakeCli}"\r\n`
    : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${fakeCli.replaceAll("'", "'\\''")}'\n`,
)
if (process.platform !== 'win32') await chmod(wrapper, 0o755)

delete process.env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [root], {
  cwd: root,
  env: {
    ...process.env,
    AGENT_WORKSPACE_E2E: '1',
    AGENT_WORKSPACE_E2E_USER_DATA: userData,
    AGENT_WORKSPACE_E2E_PROJECT: project,
    AGENT_WORKSPACE_E2E_CLI: wrapper,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
const timer = setTimeout(() => finish(1, 'Timed out waiting for Electron E2E marker'), 25_000)
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', collect)
child.stderr.on('data', collect)
child.on('error', (error) => finish(1, error.message))
child.on('exit', (code) => {
  if (settled) return
  finish(code === 0 ? 0 : 1, code === 0 ? undefined : `Electron exited with ${code}\n${output}`)
})

let settled = false
function collect(chunk) {
  output += chunk
  const marker = output.split(/\r?\n/).find((line) => line.startsWith('AGENT_WORKSPACE_E2E '))
  if (!marker) return
  const result = JSON.parse(marker.slice('AGENT_WORKSPACE_E2E '.length))
  finish(result.ok ? 0 : 1, result.ok ? undefined : `${result.error ?? 'E2E failed'}\n${output.trim()}`)
}

function finish(code, error) {
  if (settled) return
  settled = true
  clearTimeout(timer)
  if (child.exitCode === null) child.kill()
  if (error) console.error(error)
  else console.log('Electron E2E passed (session, adapter, SQLite persistence)')
  rm(temp, { recursive: true, force: true }).finally(() => process.exit(code))
}
