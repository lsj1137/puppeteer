import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'builder-util-runtime'
import type { AppUpdateState } from '@shared/app-update'

function releaseNotes(info: UpdateInfo): string | undefined {
  if (typeof info.releaseNotes === 'string') return info.releaseNotes
  if (!Array.isArray(info.releaseNotes)) return undefined
  const notes = info.releaseNotes
    .map((note) => note.note?.trim())
    .filter((note): note is string => Boolean(note))
  return notes.length ? notes.join('\n\n') : undefined
}

/** 패키징된 앱의 명시적 업데이트 흐름을 한곳에서 관리한다. */
export class AppUpdateManager {
  private state: AppUpdateState = {
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    phase: 'idle',
  }

  constructor() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.fullChangelog = false

    autoUpdater.on('checking-for-update', () => this.setState({ phase: 'checking' }))
    autoUpdater.on('update-available', (info) => {
      this.setState({
        phase: 'available',
        availableVersion: info.version,
        releaseNotes: releaseNotes(info),
        percent: undefined,
        error: undefined,
      })
    })
    autoUpdater.on('update-not-available', () => {
      this.setState({
        phase: 'up-to-date',
        availableVersion: undefined,
        releaseNotes: undefined,
        percent: undefined,
        error: undefined,
      })
    })
    autoUpdater.on('download-progress', (progress) => {
      this.setState({ phase: 'downloading', percent: Math.round(progress.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      this.setState({
        phase: 'downloaded',
        availableVersion: info.version,
        releaseNotes: releaseNotes(info),
        percent: 100,
        error: undefined,
      })
    })
    autoUpdater.on('error', (error) => {
      this.setState({ phase: 'error', error: error.message, percent: undefined })
    })
  }

  getState(): AppUpdateState {
    return { ...this.state }
  }

  async check(): Promise<AppUpdateState> {
    if (!app.isPackaged) return this.getState()
    if (this.state.phase === 'checking' || this.state.phase === 'downloading') return this.getState()
    this.setState({ phase: 'checking', error: undefined })
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.setState({
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return this.getState()
  }

  async download(): Promise<AppUpdateState> {
    if (!app.isPackaged || this.state.phase !== 'available') return this.getState()
    this.setState({ phase: 'downloading', percent: 0, error: undefined })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.setState({
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
        percent: undefined,
      })
    }
    return this.getState()
  }

  install(): void {
    if (app.isPackaged && this.state.phase === 'downloaded') {
      autoUpdater.quitAndInstall(false, true)
    }
  }

  private setState(patch: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...patch }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('app-update:state', this.getState())
    }
  }
}
