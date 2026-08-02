import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { detectRunners } from './runner-detect'
import { SessionManager } from './session-manager'
import * as db from './db'
import * as library from './agent-library'
import { route } from './router'
import * as memory from './memory'
import { build as buildCheckpoint } from './checkpoint'
import { initNotifications, setNotifyEnabled } from './notify'
import { applyUpdate, checkUpdate, fetchFromFile, fetchFromUrl } from './agent-fetch'
import type { StartSessionInput } from './session-manager'
import type {
  AgentDef,
  ApprovalDecision,
  DetectedRunner,
  FetchedAgent,
  WorktreeConflictResolverRequest,
  WorktreeResolvedFile,
  UpdateCheck,
} from '@shared/session'

let mainWindow: BrowserWindow | undefined
const conflictResolvers = new Map<string, WorktreeConflictResolverRequest>()
const conflictResolverWindows = new Map<string, { token: string; win: BrowserWindow }>()
const smokeMode = process.env['AGENT_WORKSPACE_SMOKE'] === '1'
const smokeUserData = process.env['AGENT_WORKSPACE_SMOKE_USER_DATA']

if (smokeMode && smokeUserData) app.setPath('userData', smokeUserData)

function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (hash) url.hash = hash
    win.loadURL(url.toString())
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })
  mainWindow = win
  if (!smokeMode) win.on('ready-to-show', () => win.show())
  win.on('closed', () => { mainWindow = undefined })

  // 파일 드롭이 렌더러에서 처리되지 않았을 때 창이 그 파일로 이동하는 것을 막는다
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost')) e.preventDefault()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(win)
  return win
}

function createConflictResolverWindow(
  request: WorktreeConflictResolverRequest,
  onClosed: () => void | Promise<void>,
): void {
  conflictResolvers.set(request.token, request)
  const win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })
  conflictResolverWindows.set(request.sessionId, { token: request.token, win })
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    conflictResolvers.delete(request.token)
    if (conflictResolverWindows.get(request.sessionId)?.token === request.token) {
      conflictResolverWindows.delete(request.sessionId)
    }
    void onClosed()
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost')) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRenderer(win, `worktree-conflict?token=${encodeURIComponent(request.token)}`)
}

app.whenReady().then(() => {
  db.openDb()
  initNotifications(() => mainWindow)
  const sessions = new SessionManager(() => mainWindow)

  // 실행 환경 탐지 — 사용자마다 CLI 설치 위치/방식이 다르므로 강제하지 않는다
  ipcMain.handle('runner:detect', () => detectRunners())

  ipcMain.handle('project:pick', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return undefined
    db.addProject(r.filePaths[0])
    return r.filePaths[0]
  })

  ipcMain.handle('project:list', () => db.listProjects())
  ipcMain.handle('project:remove', (_e, path: string) => db.removeProject(path))
  ipcMain.handle('project:setRunner', (_e, path: string, runnerId: string) =>
    db.setProjectRunner(path, runnerId),
  )

  ipcMain.handle('session:list', (_e, projectPath: string) => db.listSessions(projectPath))
  ipcMain.handle('session:events', (_e, sessionId: string) => db.listEvents(sessionId))
  ipcMain.handle('session:get', (_e, sessionId: string) => db.getSession(sessionId))
  ipcMain.handle('approval:open', () => db.listOpenApprovals())
  ipcMain.handle('overview:stats', () => ({
    projects: db.projectStats(),
    recent: db.recentSessions(20),
    cost: db.costTotals(),
  }))
  ipcMain.handle('session:running', () => sessions.listRunning())
  ipcMain.handle('cost:totals', () => db.costTotals())
  ipcMain.handle('notify:setEnabled', (_e, v: boolean) => setNotifyEnabled(v))

  // 에이전트는 전역 라이브러리에서 관리한다. 프로젝트 스캔은 가져오기 후보용.
  ipcMain.handle('agent:list', () => library.list())
  ipcMain.handle('agent:scan', (_e, projectPath: string) => library.scanProject(projectPath))
  ipcMain.handle('agent:save', (_e, agent: AgentDef) => library.save(agent))
  ipcMain.handle('agent:delete', (_e, name: string) => library.remove(name))
  ipcMain.handle('agent:import', (_e, projectPath: string, name: string) =>
    library.importFrom(projectPath, name),
  )
  ipcMain.handle('agent:export', (_e, name: string, projectPath: string) =>
    library.exportTo(name, projectPath),
  )
  // 가져오기는 파싱만 한다. 저장은 사용자가 검토 화면에서 승인해야 일어난다.
  ipcMain.handle('agent:fetchUrl', (_e, url: string): Promise<FetchedAgent> => fetchFromUrl(url))
  ipcMain.handle('agent:fetchFile', async (): Promise<FetchedAgent | undefined> => {
    const r = await dialog.showOpenDialog({
      title: '에이전트 파일 선택',
      filters: [{ name: 'Agent', extensions: ['md'] }],
      properties: ['openFile'],
    })
    return r.canceled || !r.filePaths[0] ? undefined : fetchFromFile(r.filePaths[0])
  })
  // 연결된 원본 확인 — 확인만 하고 바꾸지 않는다
  ipcMain.handle('agent:checkUpdate', (_e, name: string): Promise<UpdateCheck> => checkUpdate(name))
  ipcMain.handle(
    'agent:applyUpdate',
    (_e, name: string, opts: { tools?: string[]; model?: string | null }) =>
      applyUpdate(name, opts),
  )
  // Memory — CLI 가 읽는 파일이 정본이므로 앱은 그 파일을 직접 읽고 쓴다
  ipcMain.handle('memory:list', async () => {
    const runners = await detectRunners()
    return memory.list(runners, db.listProjects().map((p) => p.path))
  })
  ipcMain.handle('memory:read', (_e, id: string) => memory.read(id))
  ipcMain.handle('memory:save', (_e, id: string, content: string) => memory.save(id, content))
  ipcMain.handle('checkpoint:build', (_e, sessionId: string) => buildCheckpoint(sessionId))
  ipcMain.handle('memory:history', (_e, entryId?: string) => db.memoryEdits(entryId))

  ipcMain.handle('agent:route', (_e, instruction: string, runner: DetectedRunner, cwd: string) =>
    route(instruction, runner, cwd),
  )
  ipcMain.handle('project:reveal', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('session:changes', (_e, id: string) => sessions.changes(id))

  // 이미지 첨부 — 세션이 접근 가능한 프로젝트 내부 경로에 저장 (기획서 10장)
  ipcMain.handle(
    'attachment:save',
    (_e, projectPath: string, fileName: string, dataBase64: string) => {
      const dir = join(projectPath, '.agent-workspace', 'attachments')
      mkdirSync(dir, { recursive: true })
      const ext = extname(fileName) || '.png'
      const safe = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`
      const full = join(dir, safe)
      writeFileSync(full, Buffer.from(dataBase64, 'base64'))
      return full
    },
  )
  ipcMain.handle('session:diff', (_e, id: string, path: string) => sessions.fileDiff(id, path))

  ipcMain.handle('session:start', (_e, input: StartSessionInput) => sessions.start(input))
  ipcMain.handle('session:stop', (_e, id: string) => sessions.stop(id))
  ipcMain.handle('session:delete', (_e, id: string) => sessions.remove(id))
  ipcMain.handle('session:dropWorktree', (_e, id: string, force: boolean) =>
    sessions.dropWorktree(id, force),
  )
  ipcMain.handle('session:worktreeStatus', (_e, id: string) => sessions.worktreeStatus(id))
  ipcMain.handle('session:worktreeDiff', (_e, id: string) => sessions.worktreeDiff(id))
  ipcMain.handle('session:worktreeConflictFile', (_e, id: string, path: string) =>
    sessions.worktreeConflictFile(id, path),
  )
  ipcMain.handle('session:openWorktreeConflictResolver', (_e, id: string, files: string[]) => {
    const existing = conflictResolverWindows.get(id)
    if (existing && !existing.win.isDestroyed()) {
      existing.win.show()
      existing.win.focus()
      return existing.token
    }
    const token = randomUUID()
    createConflictResolverWindow(
      { token, sessionId: id, files },
      async () => {
        if (await sessions.abortWorktreeRebase(id)) {
          mainWindow?.webContents.send('worktree:rebaseAborted', id)
        }
      },
    )
    return token
  })
  ipcMain.handle('session:conflictResolverRequest', (_e, token: string) =>
    conflictResolvers.get(token),
  )
  ipcMain.handle(
    'session:resolveWorktreeConflicts',
    async (_e, id: string, files: WorktreeResolvedFile[]) => {
      const result = await sessions.resolveWorktreeConflicts(id, files)
      if (result.ok) mainWindow?.webContents.send('worktree:resolved', id)
      return result
    },
  )
  ipcMain.handle('session:commitWorktree', (_e, id: string, message: string) =>
    sessions.commitWorktree(id, message),
  )
  ipcMain.handle('session:rebaseWorktree', (_e, id: string, strategy?: 'origin' | 'worktree') =>
    sessions.rebaseWorktree(id, strategy),
  )
  ipcMain.handle('session:mergeWorktree', (_e, id: string) => sessions.mergeWorktree(id))
  ipcMain.handle(
    'approval:resolve',
    (_e, approvalId: string, decision: ApprovalDecision, reason?: string) =>
      sessions.resolveApproval(approvalId, decision, reason),
  )

  const win = createWindow()
  if (smokeMode) void runSmoke(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

async function runSmoke(win: BrowserWindow): Promise<void> {
  try {
    await waitForRenderer(win)
    const runners = await detectRunners()
    console.log(
      `AGENT_WORKSPACE_SMOKE ${JSON.stringify({
        ok: true,
        runners: runners.map((r) => ({
          id: r.id,
          kind: r.kind,
          provider: r.provider,
          available: r.available,
        })),
      })}`,
    )
    app.quit()
  } catch (err) {
    console.error(
      `AGENT_WORKSPACE_SMOKE ${JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })}`,
    )
    app.exit(1)
  }
}

function waitForRenderer(win: BrowserWindow): Promise<void> {
  if (!win.webContents.isLoading() && win.webContents.getURL()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', () => resolve())
    win.webContents.once('did-fail-load', (_event, code, description) => {
      reject(new Error(`renderer load failed (${code}): ${description}`))
    })
  })
}
