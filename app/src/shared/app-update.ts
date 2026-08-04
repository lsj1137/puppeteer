export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'

export interface AppUpdateState {
  currentVersion: string
  packaged: boolean
  phase: AppUpdatePhase
  availableVersion?: string
  releaseNotes?: string
  percent?: number
  error?: string
}
