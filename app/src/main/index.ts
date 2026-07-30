import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, extname } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { detectRunners } from './runner-detect'
import { SessionManager } from './session-manager'
import * as db from './db'
import * as agents from './agents'
import { route } from './router'
import type { StartSessionInput } from './session-manager'
import type { AgentDef, ApprovalDecision, DetectedRunner } from '@shared/session'

let mainWindow: BrowserWindow | undefined

function createWindow(): void {
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
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => { mainWindow = undefined })

  // 파일 드롭이 렌더러에서 처리되지 않았을 때 창이 그 파일로 이동하는 것을 막는다
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost')) e.preventDefault()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  db.openDb()
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

  ipcMain.handle('agent:list', (_e, projectPath: string) => agents.listAgents(projectPath))
  ipcMain.handle('agent:save', (_e, agent: AgentDef) => agents.saveAgent(agent))
  ipcMain.handle('agent:route', (_e, instruction: string, runner: DetectedRunner, cwd: string) =>
    route(instruction, runner, cwd),
  )
  ipcMain.handle('agent:delete', (_e, projectPath: string, name: string) =>
    agents.deleteAgent(projectPath, name),
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
  ipcMain.handle(
    'approval:resolve',
    (_e, approvalId: string, decision: ApprovalDecision, reason?: string) =>
      sessions.resolveApproval(approvalId, decision, reason),
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
