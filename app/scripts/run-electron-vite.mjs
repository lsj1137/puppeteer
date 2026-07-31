import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

delete process.env.ELECTRON_RUN_AS_NODE

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const packageRoot = dirname(require.resolve('electron-vite/package.json'))
const cli = join(packageRoot, 'bin', 'electron-vite.js')
const child = spawn(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
