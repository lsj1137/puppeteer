import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import type { CliUpdatePlan, CliUpdateResult, DetectedRunner, ProviderId } from '@shared/session'
// 러너 실행 명령은 provider 공용이다(WSL·Windows 인용 규칙이 같다).
import { buildRunnerCommand, type RunnerCommand } from './adapters/claude-cli'

/**
 * 실행 환경의 CLI 를 최신으로 올린다.
 *
 * **설치에 쓴 도구로 올린다.** 한 PC 에 Windows npm 설치본과 WSL bun 설치본이 같이 있는
 * 경우가 흔하고, WSL 은 interop 으로 Windows PATH 를 뒤에 붙인다. 바 `npm` 을 부르면
 * WSL 안에서도 Windows npm 이 잡혀 엉뚱한 설치본을 올린다. 그래서 bun·npm 은 탐지된
 * 실행 파일과 같은 폴더의 것을 절대경로로 쓴다.
 *
 * 명령은 전부 고정 인자다. 사용자 입력이 들어가지 않고, WSL 은 세션 실행과 같은
 * `buildRunnerCommand`(셸 평가 없음)로 띄운다.
 */
const PACKAGES: Partial<Record<ProviderId, string>> = {
  'claude-cli': '@anthropic-ai/claude-code',
  'codex-cli': '@openai/codex',
}

const TIMEOUT_MS = 5 * 60_000

interface UpdateStep {
  executable: string
  args: string[]
}

function sibling(runner: DetectedRunner, name: string): string {
  const path = runner.kind === 'windows-native' ? win32 : posix
  return path.join(path.dirname(runner.executable), name)
}

export function updateStep(runner: DetectedRunner): UpdateStep | { unsupported: string } {
  const pkg = PACKAGES[runner.provider]
  if (!pkg || runner.kind === 'custom') {
    return { unsupported: '이 실행 환경은 앱에서 업데이트할 수 없습니다.' }
  }
  const windows = runner.kind === 'windows-native'

  if (runner.installMethod === 'bun') {
    return { executable: sibling(runner, windows ? 'bun.exe' : 'bun'), args: ['add', '-g', `${pkg}@latest`] }
  }
  // Claude CLI 는 npm·네이티브 설치본을 스스로 올리는 `update` 명령을 갖고 있다.
  if (runner.provider === 'claude-cli') {
    return { executable: runner.executable, args: [...(runner.executableArgs ?? []), 'update'] }
  }
  if (runner.installMethod === 'npm') {
    // Windows 는 interop 문제가 없고, 전역 npm 이 CLI 폴더에 없는 경우가 보통이라 PATH 의 것을 쓴다.
    return {
      executable: windows ? 'npm.cmd' : sibling(runner, 'npm'),
      args: ['install', '-g', `${pkg}@latest`],
    }
  }
  return {
    unsupported:
      'VS Code 확장·데스크톱 앱에 들어 있거나 설치 방식을 알 수 없는 Codex 는 앱에서 올리지 않습니다. 설치한 방법으로 직접 업데이트해 주세요.',
  }
}

function describe(runner: DetectedRunner, step: UpdateStep): string {
  const command = [step.executable, ...step.args].join(' ')
  return runner.kind === 'wsl' ? `[WSL ${runner.distro ?? 'Ubuntu'}] ${command}` : command
}

export function plan(runner: DetectedRunner): CliUpdatePlan {
  const step = updateStep(runner)
  return 'unsupported' in step ? step : { command: describe(runner, step) }
}

export function updateCommand(runner: DetectedRunner, hostPlatform = process.platform): RunnerCommand | undefined {
  const step = updateStep(runner)
  if ('unsupported' in step) return undefined
  // WSL 은 `--cd` 가 필요하다. 업데이트는 작업 폴더와 무관하므로 홈에서 돈다.
  return buildRunnerCommand({ ...runner, executable: step.executable, executableArgs: [] }, '~', step.args, hostPlatform)
}

/** 설치 도구 출력은 길고 진행 표시가 섞인다. 색 코드를 걷고 끝부분만 남긴다. */
export function outputTail(raw: string, lines = 15): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .split(/\r?\n|\r/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-lines)
    .join('\n')
}

export function run(runner: DetectedRunner): Promise<CliUpdateResult> {
  const step = updateStep(runner)
  const built = updateCommand(runner)
  if ('unsupported' in step || !built) {
    return Promise.resolve({ ok: false, command: '', output: 'unsupported' in step ? step.unsupported : '' })
  }
  const command = describe(runner, step)

  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    const child = spawn(built.command, built.args, {
      cwd: homedir(),
      windowsHide: true,
      windowsVerbatimArguments: built.windowsVerbatimArguments,
    })
    const collect = (chunk: Buffer): void => {
      output = (output + chunk.toString()).slice(-20_000)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, TIMEOUT_MS)

    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, command, output: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const tail = outputTail(output)
      resolve({
        ok: code === 0 && !timedOut,
        command,
        output: timedOut ? `${tail}\n5분이 지나 중단했습니다.`.trim() : tail,
      })
    })
  })
}
