import { BrowserWindow, Notification } from 'electron'
import { execFile } from 'node:child_process'
import type { ApprovalRequest, SessionStatus } from '@shared/session'

/**
 * OS 알림.
 *
 * 앱을 보고 있지 않을 때만 띄운다. 창이 앞에 있으면 화면에 이미 다 보이므로
 * 알림은 소음일 뿐이다.
 *
 * 승인 요청이 특히 중요하다 — hook 타임아웃이 280초라, 자리를 비운 사이
 * 조용히 거부되고 에이전트가 다른 길로 새어버린다.
 */

let enabled = true
let getWindow: () => BrowserWindow | undefined = () => undefined

/** electron-builder의 package.json build.appId와 반드시 같아야 한다. */
export const APP_USER_MODEL_ID = 'com.lsj1137.puppeteer'

export function initNotifications(win: () => BrowserWindow | undefined): void {
  getWindow = win
  // AppUserModelID는 창 생성 전에 index.ts에서 환경에 맞게 한 번 설정한다.
  // 여기서 다시 설정하면 개발용 ID가 설치본 ID로 덮여 작업표시줄 그룹이 섞인다.
}

export function setNotifyEnabled(v: boolean): void {
  enabled = v
}

/** 창이 보이고 포커스까지 있으면 굳이 알리지 않는다 */
function shouldNotify(): boolean {
  if (!enabled) return false
  if (process.platform !== 'darwin' && !Notification.isSupported()) return false
  const win = getWindow()
  return !win || !win.isFocused() || win.isMinimized()
}

function show(title: string, body: string, jump?: { sessionId: string; cwd: string }): void {
  if (!shouldNotify()) return

  const n = new Notification({ title, body, silent: false })
  n.on('failed', () => {
    if (process.platform === 'darwin') showMacFallback(title, body)
  })
  n.on('click', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (jump) win.webContents.send('notify:jump', jump)
  })
  n.show()
}

const MAC_NOTIFICATION_SCRIPT = `
on run argv
  display notification (item 2 of argv) with title (item 1 of argv)
end run
`.trim()

export function macNotificationArgs(title: string, body: string): string[] {
  return ['-e', MAC_NOTIFICATION_SCRIPT, title, body]
}

function showMacFallback(title: string, body: string): void {
  execFile(
    'osascript',
    macNotificationArgs(title, body),
    { timeout: 5_000, windowsHide: true },
    () => {},
  )
}

export function notifyApproval(req: ApprovalRequest): void {
  const detail = summarize(req.input)
  show(`승인 대기 · ${req.tool}`, detail ? `${baseName(req.cwd)} — ${detail}` : baseName(req.cwd), {
    sessionId: req.sessionId,
    cwd: req.projectPath ?? req.cwd,
  })
}

/** 알림 본문에 쓸 한 줄. 명령이나 파일 경로가 있으면 그걸 보여준다. */
function summarize(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const pick = (k: string): string | undefined =>
    typeof i[k] === 'string' ? (i[k] as string) : undefined
  return (pick('command') ?? pick('file_path') ?? pick('description') ?? '').slice(0, 100)
}

const DONE: Partial<Record<SessionStatus, string>> = {
  completed: '완료',
  failed: '실패',
  'auth-required': '로그인 필요',
}

export function notifyStatus(
  status: SessionStatus,
  title: string,
  cwd: string,
  sessionId: string,
  reason?: string,
): void {
  const label = DONE[status]
  if (!label) return
  const body = reason ? `${baseName(cwd)} — ${reason.slice(0, 120)}` : baseName(cwd)
  show(`${label} · ${title.slice(0, 40)}`, body, { sessionId, cwd })
}

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
