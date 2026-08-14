import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { dirname, join, extname, resolve, sep } from 'node:path'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { detectRunners } from './runner-detect'
import { SessionManager } from './session-manager'
import * as db from './db'
import * as library from './agent-library'
import { route } from './router'
import * as memory from './memory'
import * as skills from './skill-library'
import { build as buildCheckpoint } from './checkpoint'
import { commitProjectMemory, gitHistory, isRepo, projectMemoryDirty, repairLinkedWorktrees } from './git'
import { APP_USER_MODEL_ID, initNotifications, setNotifyEnabled } from './notify'
import { applyUpdate, checkUpdate, fetchFromFile, fetchFromUrl } from './agent-fetch'
import { AppUpdateManager } from './app-update'
import type { StartSessionInput } from './session-manager'
import type {
  AgentDef,
  ApprovalDecision,
  ApprovalMode,
  DetectedRunner,
  FetchedAgent,
  SkillDef,
  WorktreeIntegrationMode,
  WorktreeConflictResolverRequest,
  WorktreeResolvedFile,
  UpdateCheck,
} from '@shared/session'

const WORKTREE_INTEGRATION_SETTING = 'worktree_integration_mode'

function canonicalPath(path: string): string {
  const value = resolve(path)
  return process.platform === 'win32' ? value.toLocaleLowerCase() : value
}

function worktreeIntegrationMode(): WorktreeIntegrationMode {
  return db.getSetting(WORKTREE_INTEGRATION_SETTING) === 'auto' ? 'auto' : 'suggest'
}

function projectWorktreeIntegrationMode(path: string): WorktreeIntegrationMode {
  return db.projectWorktreeMode(path)
}

function projectRootForMemoryId(id: string): string | undefined {
  if (!id.startsWith('file:')) return undefined
  const root = dirname(id.slice('file:'.length))
  return db.listProjects().some((project) => canonicalPath(project.path) === canonicalPath(root))
    ? root
    : undefined
}

let mainWindow: BrowserWindow | undefined
const conflictResolvers = new Map<string, WorktreeConflictResolverRequest>()
const conflictResolverWindows = new Map<string, { token: string; win: BrowserWindow }>()
const smokeMode = process.env['AGENT_WORKSPACE_SMOKE'] === '1'
const smokeUserData = process.env['AGENT_WORKSPACE_SMOKE_USER_DATA']
const e2eMode = process.env['AGENT_WORKSPACE_E2E'] === '1'
const e2eUserData = process.env['AGENT_WORKSPACE_E2E_USER_DATA']

// Windows 작업표시줄은 창 icon보다 AppUserModelID로 실행 파일·바로가기 그룹 아이콘을
// 결정한다. 설치본은 electron-builder appId와 맞추고 개발본은 별도 그룹으로 분리한다.
const runtimeAppUserModelId = app.isPackaged
  ? APP_USER_MODEL_ID
  : `${APP_USER_MODEL_ID}.dev`

app.setName('Puppeteer')
// app.getName() 이 userData 경로(<appData>/<name>)를 결정한다. 표시 이름을 바꾸면
// 기존 프로젝트·세션 DB 를 못 읽고 빈 DB 가 새로 생기므로 위치를 명시적으로 고정한다.
app.setPath('userData', join(app.getPath('appData'), 'agent-workspace'))
if (process.platform === 'win32') app.setAppUserModelId(runtimeAppUserModelId)

if (smokeMode && smokeUserData) app.setPath('userData', smokeUserData)
if (e2eMode && e2eUserData) app.setPath('userData', e2eUserData)

// Windows 알림이나 바로가기를 눌렀을 때 두 번째 Electron 인스턴스가 뜨지 않게 한다.
// smoke는 설치본과 동시에 검증할 수 있어야 하므로 잠금 대상에서 제외한다.
const hasSingleInstanceLock = smokeMode || e2eMode || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => focusMainWindow())
}

function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (hash) url.hash = hash
    win.loadURL(url.toString())
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function appIconPath(): string {
  if (process.platform === 'win32') {
    return app.isPackaged
      ? join(process.resourcesPath, 'app-icon.ico')
      : join(app.getAppPath(), 'resources', 'icon.ico')
  }
  return app.isPackaged
    ? join(process.resourcesPath, 'app-icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
}

/** 개발용 electron.exe와 설치본 모두 같은 Windows 작업표시줄 정체성을 사용한다. */
function applyWindowIdentity(win: BrowserWindow, icon: string): void {
  win.setIcon(icon)
  if (process.platform !== 'win32') return
  win.setAppDetails({
    appId: runtimeAppUserModelId,
    // 실행 파일 리소스나 Windows 아이콘 캐시에 기대지 않고 동봉 ICO를 명시한다.
    appIconPath: icon,
    appIconIndex: 0,
  })
}

function createWindow(getActiveWorkCount: () => number, onConfirmedClose: () => void): BrowserWindow {
  const icon = appIconPath()
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })
  mainWindow = win
  let closeConfirmed = false
  win.on('close', (event) => {
    if (closeConfirmed) return
    const activeCount = getActiveWorkCount()
    if (activeCount === 0) return

    event.preventDefault()
    const response = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: '실행 중인 세션이 있습니다',
      message: `${activeCount}개의 작업이 아직 실행 중입니다.`,
      detail: '지금 종료하면 실행 중인 작업이 중단될 수 있습니다.',
      buttons: ['계속 작업', '그래도 종료'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (response === 1) {
      onConfirmedClose()
      closeConfirmed = true
      win.close()
    }
  })
  applyWindowIdentity(win, icon)
  let rendererRecoveryAttempts = 0
  let rendererRecoveryTimer: ReturnType<typeof setTimeout> | undefined
  let rendererStableTimer: ReturnType<typeof setTimeout> | undefined
  const recoverRenderer = (reason: string): void => {
    if (rendererRecoveryAttempts >= 2 || win.isDestroyed() || rendererRecoveryTimer) return
    if (rendererStableTimer) clearTimeout(rendererStableTimer)
    rendererRecoveryAttempts++
    console.error(`renderer recovery ${rendererRecoveryAttempts}/2: ${reason}`)
    rendererRecoveryTimer = setTimeout(() => {
      rendererRecoveryTimer = undefined
      if (!win.isDestroyed()) loadRenderer(win)
    }, 500)
  }
  win.webContents.on('did-finish-load', () => {
    if (rendererStableTimer) clearTimeout(rendererStableTimer)
    rendererStableTimer = setTimeout(() => { rendererRecoveryAttempts = 0 }, 30_000)
  })
  win.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) recoverRenderer(`load failed (${code}): ${description}`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') recoverRenderer(`render process gone: ${details.reason}`)
  })
  if (!smokeMode && !e2eMode) win.on('ready-to-show', () => {
    applyWindowIdentity(win, icon)
    win.show()
  })
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
  const icon = appIconPath()
  const win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })
  applyWindowIdentity(win, icon)
  conflictResolverWindows.set(request.sessionId, { token: request.token, win })
  win.on('ready-to-show', () => {
    applyWindowIdentity(win, icon)
    win.show()
  })
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
  if (!hasSingleInstanceLock) return
  db.openDb()
  // 이전 앱 프로세스와 함께 승인 hook도 사라졌다. 응답할 수 없는 요청을 재노출하지 않는다.
  db.discardOpenApprovals()
  initNotifications(() => mainWindow)
  const sessions = new SessionManager(() => mainWindow)
  const appUpdates = new AppUpdateManager()

  ipcMain.handle('app-update:state', () => appUpdates.getState())
  ipcMain.handle('app-update:check', () => appUpdates.check())
  ipcMain.handle('app-update:download', () => appUpdates.download())
  ipcMain.handle('app-update:install', () => appUpdates.install())

  // 실행 환경 탐지 — 사용자마다 CLI 설치 위치/방식이 다르므로 강제하지 않는다
  ipcMain.handle('runner:detect', () => detectRunners())

  ipcMain.handle('project:pick', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return undefined
    db.addProject(r.filePaths[0])
    return r.filePaths[0]
  })

  ipcMain.handle('project:list', () => db.listProjects())
  ipcMain.handle('project:reorder', (_e, paths: string[]) => db.reorderProjects(paths))
  ipcMain.handle('project:rename', (_e, path: string, alias: string) => db.renameProject(path, alias))
  ipcMain.handle('project:setWorktreeMode', async (_e, path: string, mode: WorktreeIntegrationMode) => {
    if (mode !== 'off' && mode !== 'auto' && mode !== 'suggest') {
      throw new Error('지원하지 않는 프로젝트 Worktree 방식입니다.')
    }
    return sessions.setProjectWorktreeMode(path, mode)
  })
  ipcMain.handle('project:relink', async (_e, oldPath: string) => {
    if (sessions.listRunning().some(({ projectPath }) => canonicalPath(projectPath) === canonicalPath(oldPath))) {
      return { ok: false, oldPath, message: '실행 중인 세션을 먼저 종료해 주세요.' }
    }
    const picked = await dialog.showOpenDialog({
      title: '이동한 프로젝트 폴더 선택',
      defaultPath: dirname(oldPath),
      properties: ['openDirectory'],
    })
    if (picked.canceled || !picked.filePaths[0]) {
      return { ok: false, canceled: true, oldPath, message: '프로젝트 재연결을 취소했습니다.' }
    }
    const newPath = picked.filePaths[0]
    if (!existsSync(newPath) || !statSync(newPath).isDirectory()) {
      return { ok: false, oldPath, newPath, message: '선택한 프로젝트 폴더를 읽을 수 없습니다.' }
    }

    const worktrees = db.projectWorktrees(oldPath)
    if (worktrees.length > 0) {
      if (!(await isRepo(newPath))) {
        return { ok: false, oldPath, newPath, message: '기존 worktree가 있어 새 위치의 Git 저장소를 확인해야 합니다.' }
      }
      const existingWorktrees = worktrees.filter(({ path }) => existsSync(path))
      const repaired = await repairLinkedWorktrees(newPath, existingWorktrees.map(({ path }) => path))
      if (!repaired.ok) return { ok: false, oldPath, newPath, message: repaired.message }
    }

    try {
      const project = db.relinkProject(oldPath, newPath)
      const agents = library.relinkProject(oldPath, newPath)
      const missingWorktrees = worktrees.filter(({ path }) => !existsSync(path)).length
      return {
        ok: true,
        oldPath,
        newPath,
        project,
        message: `프로젝트와 세션 경로를 갱신했습니다.${agents ? ` Agent ${agents}개도 갱신했습니다.` : ''}${missingWorktrees ? ` 삭제된 과거 worktree ${missingWorktrees}개는 Git 복구에서 제외했습니다.` : ''}`,
      }
    } catch (error) {
      return {
        ok: false,
        oldPath,
        newPath,
        message: error instanceof Error ? error.message : '프로젝트 경로를 갱신하지 못했습니다.',
      }
    }
  })
  ipcMain.handle('project:remove', (_e, path: string) => db.removeProject(path))
  ipcMain.handle('project:setRunner', (_e, path: string, runnerId: string) =>
    db.setProjectRunner(path, runnerId),
  )

  ipcMain.handle('session:list', (_e, projectPath: string) => db.listSessions(projectPath))
  ipcMain.handle('session:listHidden', (_e, projectPath: string) => db.listHiddenSessions(projectPath))
  ipcMain.handle('session:reorder', (_e, projectPath: string, ids: string[]) =>
    db.reorderSessions(projectPath, ids),
  )
  ipcMain.handle('session:setHidden', (_e, sessionId: string, hidden: boolean) => {
    const session = db.getSession(sessionId)
    if (!session) throw new Error('세션을 찾을 수 없습니다.')
    if (hidden && sessions.listRunning().some(({ id }) => id === sessionId)) {
      throw new Error('실행 중인 세션은 숨길 수 없습니다.')
    }
    if (hidden && db.listOpenApprovals().some(({ sessionId: id }) => id === sessionId)) {
      throw new Error('승인 대기 중인 세션은 숨길 수 없습니다.')
    }
    return db.setSessionHidden(sessionId, hidden)
  })
  ipcMain.handle('session:events', (_e, sessionId: string) => db.listEvents(sessionId))
  ipcMain.handle('session:get', (_e, sessionId: string) => db.getSession(sessionId))
  ipcMain.handle('session:rename', (_e, sessionId: string, title: string) =>
    sessions.renameSession(sessionId, title),
  )
  ipcMain.handle('session:setApprovalMode', (_e, sessionId: string, mode: ApprovalMode) => {
    if (mode !== 'ask' && mode !== 'auto') throw new Error('지원하지 않는 승인 모드입니다.')
    return sessions.setApprovalMode(sessionId, mode)
  })
  ipcMain.handle('approval:open', () => db.listOpenApprovals())
  ipcMain.handle('overview:stats', () => ({
    projects: db.projectStats(),
    recent: db.recentSessions(20),
    cost: db.costTotals(),
  }))
  ipcMain.handle('session:running', () => sessions.listRunning())
  ipcMain.handle('cost:totals', () => db.costTotals())
  ipcMain.handle('notify:setEnabled', (_e, v: boolean) => setNotifyEnabled(v))
  ipcMain.handle('worktree:integrationMode', () => worktreeIntegrationMode())
  ipcMain.handle('worktree:setIntegrationMode', (_e, mode: WorktreeIntegrationMode) => {
    if (mode !== 'auto' && mode !== 'suggest') throw new Error('지원하지 않는 worktree 반영 방식입니다.')
    db.setSetting(WORKTREE_INTEGRATION_SETTING, mode)
  })

  // 에이전트는 전역 라이브러리에서 관리한다. 프로젝트 스캔은 가져오기 후보용.
  ipcMain.handle('agent:list', () => library.list())
  ipcMain.handle('agent:scan', (_e, projectPath: string) => library.scanProject(projectPath))
  ipcMain.handle('agent:save', (_e, agent: AgentDef) => library.save(agent))
  ipcMain.handle('agent:delete', (_e, name: string) => library.remove(name))
  ipcMain.handle('agent:import', (_e, projectPath: string, name: string) =>
    library.importFrom(projectPath, name),
  )
  ipcMain.handle('agent:export', (
    _e,
    name: string,
    projectPath: string,
    format: library.AgentExportFormat = 'claude-agent',
  ) => library.exportTo(name, projectPath, format),
  )
  ipcMain.handle('agent:exportAnywhere', async (
    _e,
    name: string,
    format: library.AgentExportFormat = 'claude-agent',
  ): Promise<string | undefined> => {
    if (format === 'codex-skill') {
      const result = await dialog.showOpenDialog({
        title: 'Codex Skill을 내보낼 폴더 선택',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || !result.filePaths[0]) return undefined
      return library.exportFile(name, join(result.filePaths[0], name, 'SKILL.md'), format)
    }
    const result = await dialog.showSaveDialog({
      title: 'Agent Markdown 내보내기',
      defaultPath: `${name}.md`,
      filters: [{ name: 'Agent Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return undefined
    return library.exportFile(name, result.filePath, format)
  })
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
  ipcMain.handle('memory:save', async (_e, id: string, content: string) => {
    const projectRoot = projectRootForMemoryId(id)
    const memoryWasClean = projectRoot ? !(await projectMemoryDirty(projectRoot)) : false
    const saved = memory.save(id, content)
    if (saved && projectRoot && memoryWasClean && projectWorktreeIntegrationMode(projectRoot) === 'auto') {
      await commitProjectMemory(projectRoot)
    }
    return saved
  })
  ipcMain.handle(
    'memory:promoteGlobal',
    async (_e, sourceId: string, targetId: string, content: string) => {
      const runners = await detectRunners()
      const entries = memory.list(runners, db.listProjects().map((project) => project.path))
      const source = entries.find((entry) => entry.id === sourceId)
      const target = entries.find((entry) => entry.id === targetId)
      if (!source || !target) return { ok: false, message: 'Memory 항목을 다시 불러오세요.' }
      return memory.promoteToGlobal(source, target, content)
    },
  )
  ipcMain.handle('checkpoint:build', (_e, sessionId: string) => buildCheckpoint(sessionId))
  ipcMain.handle('memory:history', (_e, entryId?: string) => db.memoryEdits(entryId))
  ipcMain.handle('memory:proposals', () => db.memoryProposals())
  ipcMain.handle('memory:proposal:approve', async (_e, id: number) => {
    const proposal = db.getMemoryProposal(id)
    if (!proposal || proposal.status !== 'pending') return false
    const projectRoot = projectRootForMemoryId(proposal.entryId)
    const memoryWasClean = projectRoot ? !(await projectMemoryDirty(projectRoot)) : false
    const applied = memory.applyProposal(proposal)
    if (applied) {
      db.decideMemoryProposal(id, 'approved')
      if (
        proposal.scope === 'project'
        && projectRoot
        && memoryWasClean
        && projectWorktreeIntegrationMode(projectRoot) === 'auto'
      ) {
        // 승인이 명시된 정본 파일만 커밋한다. 실패해도 이미 적용된 Memory 승인을 되돌리지는 않는다.
        await commitProjectMemory(projectRoot)
      }
    }
    return applied
  })
  ipcMain.handle('memory:proposal:reject', (_e, id: number) => {
    db.decideMemoryProposal(id, 'rejected')
  })
  ipcMain.handle('skill:list', () =>
    skills.list(db.listProjects().map((project) => project.path), library.list().map((agent) => agent.name)),
  )
  ipcMain.handle('skill:importFile', async (): Promise<import('@shared/session').SkillImportPreview | undefined> => {
    const result = await dialog.showOpenDialog({
      title: 'Codex 또는 공통 SKILL.md 선택',
      filters: [{ name: 'Skill Markdown', extensions: ['md'] }],
      properties: ['openFile'],
    })
    return result.canceled || !result.filePaths[0]
      ? undefined
      : skills.previewImport(result.filePaths[0])
  })
  const assertSkillTarget = (skill: SkillDef): void => {
    if (skill.scope === 'project' && !db.listProjects().some((p) => p.path === skill.projectPath)) {
      throw new Error('등록되지 않은 프로젝트에는 Skill을 저장할 수 없습니다.')
    }
    if (skill.scope === 'agent' && !library.read(skill.agentName ?? '')) {
      throw new Error('존재하지 않는 에이전트에는 Skill을 저장할 수 없습니다.')
    }
  }
  ipcMain.handle('skill:save', (_e, skill: SkillDef) => {
    assertSkillTarget(skill)
    return skills.save(skill)
  })
  ipcMain.handle('skill:move', (_e, previous: SkillDef, next: SkillDef) => {
    assertSkillTarget(next)
    return skills.move(previous, next)
  })
  ipcMain.handle('skill:export', async (_e, skill: SkillDef): Promise<boolean> => {
    assertSkillTarget(skill)
    const result = await dialog.showSaveDialog({
      title: 'SKILL.md 내보내기',
      defaultPath: `${skill.name}-SKILL.md`,
      filters: [{ name: 'Skill Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return false
    skills.exportFile(skill, result.filePath)
    return true
  })
  ipcMain.handle('skill:delete', (_e, skill: SkillDef) => {
    assertSkillTarget(skill)
    skills.remove(skill)
  })

  ipcMain.handle('agent:route', (_e, instruction: string, runner: DetectedRunner, cwd: string) =>
    route(instruction, runner, cwd),
  )
  ipcMain.handle('project:reveal', (_e, path: string) => shell.openPath(path))
  const canonicalProjectPath = (path: string): string => {
      const value = resolve(path)
      return process.platform === 'win32' ? value.toLocaleLowerCase() : value
  }
  const assertProjectRoot = (root: string): void => {
    const target = canonicalProjectPath(root)
    const projects = db.listProjects()
    const roots = projects.flatMap((project) => [
      project.path,
      ...db.listSessions(project.path).flatMap((session) =>
        session.worktree?.path ? [session.worktree.path] : [],
      ),
    ])
    if (!roots.some((path) => canonicalProjectPath(path) === target)) {
      throw new Error('등록되지 않은 프로젝트 경로입니다.')
    }
  }
  const projectFilePath = (root: string, path: string): string => {
    assertProjectRoot(root)
    const base = resolve(root)
    const full = resolve(base, path)
    const canonicalBase = canonicalProjectPath(base)
    const canonicalFull = canonicalProjectPath(full)
    if (canonicalFull !== canonicalBase && !canonicalFull.startsWith(canonicalBase + sep)) {
      throw new Error('프로젝트 밖의 파일은 읽을 수 없습니다.')
    }
    return full
  }

  ipcMain.handle('project:isGit', (_e, root: string) => {
    assertProjectRoot(root)
    return isRepo(root)
  })
  ipcMain.handle('project:files', (_e, root: string) => {
    assertProjectRoot(root)

    const ignored = new Set(['.git', 'node_modules', 'dist', 'dist_electron', 'out', '.next', 'coverage'])
    const entries: { path: string; kind: 'file' | 'directory' }[] = []
    const visit = (dir: string, relative = ''): void => {
      if (entries.length >= 2000) return
      let children
      try {
        children = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      children.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      for (const child of children) {
        if (ignored.has(child.name)) continue
        const path = relative ? `${relative}/${child.name}` : child.name
        entries.push({ path, kind: child.isDirectory() ? 'directory' : 'file' })
        if (child.isDirectory()) visit(join(dir, child.name), path)
        if (entries.length >= 2000) break
      }
    }
    visit(root)
    return entries
  })
  ipcMain.handle('project:readFile', (_e, root: string, path: string) => {
    const full = projectFilePath(root, path)
    try {
      const size = statSync(full).size
      if (size > 1024 * 1024) return { path, size, reason: 'too-large' as const }
      const data = readFileSync(full)
      if (data.includes(0)) return { path, size, reason: 'binary' as const }
      return { path, size, content: data.toString('utf8') }
    } catch {
      return { path, size: 0, reason: 'unreadable' as const }
    }
  })
  ipcMain.handle('project:gitHistory', (_e, path: string, limit?: number) =>
    gitHistory(path, limit),
  )
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

  const win = createWindow(
    () => sessions.activeWorkCount(),
    () => { db.discardOpenApprovals() },
  )
  if (!smokeMode && app.isPackaged) {
    setTimeout(() => void appUpdates.check(), 10_000)
  }
  if (smokeMode) void runSmoke(win)
  if (e2eMode) void runE2E(win, sessions)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(
        () => sessions.activeWorkCount(),
        () => { db.discardOpenApprovals() },
      )
    }
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

async function runE2E(win: BrowserWindow, sessions: SessionManager): Promise<void> {
  try {
    await waitForRenderer(win)
    const cwd = process.env['AGENT_WORKSPACE_E2E_PROJECT']
    const executable = process.env['AGENT_WORKSPACE_E2E_NODE']
    const script = process.env['AGENT_WORKSPACE_E2E_SCRIPT']
    if (!cwd || !executable || !script) throw new Error('E2E project or CLI path is missing')
    mkdirSync(cwd, { recursive: true })
    const runner: DetectedRunner = {
      id: 'e2e:claude-cli',
      kind: process.platform === 'win32' ? 'windows-native' : 'posix',
      provider: 'claude-cli',
      executable,
      executableArgs: [script],
      installMethod: 'unknown',
      available: true,
    }
    const id = await sessions.start({ cwd, prompt: 'E2E 요청', runner, isolate: false })
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const stored = db.getSession(id)
      if (stored?.status === 'completed') {
        const events = db.listEvents(id)
        const hasReply = events.some(
          ({ event }) => event.t === 'message' && event.role === 'assistant' && event.text === 'E2E 응답 완료',
        )
        if (!hasReply || stored.cliSessionId !== 'e2e-cli-session') {
          throw new Error('E2E session events were not persisted correctly')
        }
        console.log(`AGENT_WORKSPACE_E2E ${JSON.stringify({ ok: true, sessionId: id })}`)
        app.quit()
        return
      }
      if (stored?.status === 'failed' || stored?.status === 'auth-required') {
        const reason = db
          .listEvents(id)
          .map(({ event }) => event)
          .filter((event) => event.t === 'status' && event.reason)
          .at(-1)
        throw new Error(
          `E2E session ${stored.status}: ${reason?.t === 'status' ? reason.reason : 'reason unavailable'}`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('E2E session did not complete')
  } catch (error) {
    console.error(
      `AGENT_WORKSPACE_E2E ${JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
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
