import type { WorkspaceApi } from './index'

declare global {
  interface Window {
    api: WorkspaceApi
  }
}

export {}
