import type {
  GitSnapshot,
  RateLimitInfo,
  SessionEvent,
  SessionMeta,
  SessionStatus,
  StoredSession,
} from '@shared/session'
import { toUiArtifactKind } from './artifacts'
import { splitFences, type Segment, type UiArtifact } from './fences'

export type Entry =
  | { kind: 'assistant'; id: string; segments: Segment[]; isError?: boolean }
  | { kind: 'notice'; id: string; level: 'info' | 'warning' | 'error'; title: string; text: string }
  | {
      kind: 'tool'
      id: string
      toolUseId: string
      name: string
      input: unknown
      result?: { ok: boolean; preview: string }
    }
  | { kind: 'user'; id: string; text: string }

export interface SessionView {
  entries: Entry[]
  artifacts: UiArtifact[]
  cost: number
  tokens: number
  status?: SessionStatus
  statusReason?: string
  meta?: SessionMeta
  rateLimit?: RateLimitInfo
  snapshot?: GitSnapshot
  conflicts: { path: string; otherTitle: string }[]
}

export const EMPTY_SESSION_VIEW: SessionView = {
  entries: [],
  artifacts: [],
  cost: 0,
  tokens: 0,
  conflicts: [],
}

/** 실시간 이벤트와 DB 복원이 공유하는 단일 reducer. */
export function reduceSessionView(v: SessionView, e: SessionEvent, key: string): SessionView {
  switch (e.t) {
    case 'status':
      return { ...v, status: e.status, statusReason: e.reason }
    case 'session-meta':
      return { ...v, meta: e.meta }
    case 'rate-limit':
      return { ...v, rateLimit: e.info }
    case 'message': {
      if (e.role === 'user') {
        return { ...v, entries: [...v.entries, { kind: 'user', id: key, text: e.text }] }
      }
      if (e.isError) {
        return {
          ...v,
          entries: [...v.entries, { kind: 'assistant', id: key, segments: [], isError: true }],
          statusReason: e.text,
        }
      }
      const { segments, artifacts } = splitFences(e.text, key)
      return {
        ...v,
        entries: [...v.entries, { kind: 'assistant', id: key, segments }],
        artifacts: [...v.artifacts, ...artifacts],
      }
    }
    case 'notice':
      return {
        ...v,
        entries: [
          ...v.entries,
          { kind: 'notice', id: key, level: e.level, title: e.title, text: e.text },
        ],
      }
    case 'tool-use':
      return {
        ...v,
        entries: [
          ...v.entries,
          { kind: 'tool', id: key, toolUseId: e.toolUseId, name: e.name, input: e.input },
        ],
      }
    case 'tool-result':
      return {
        ...v,
        entries: v.entries.map((entry) =>
          entry.kind === 'tool' && entry.toolUseId === e.toolUseId
            ? { ...entry, result: { ok: e.ok, preview: e.preview } }
            : entry,
        ),
      }
    case 'artifact':
      return {
        ...v,
        artifacts: [
          ...v.artifacts,
          {
            id: `${key}-${e.kind}`,
            kind: toUiArtifactKind(e.kind),
            language: e.language,
            path: e.path,
            content: e.content,
          },
        ],
      }
    case 'snapshot':
      return { ...v, snapshot: e.snapshot }
    case 'conflict':
      return v.conflicts.some((conflict) => conflict.path === e.path)
        ? v
        : { ...v, conflicts: [...v.conflicts, { path: e.path, otherTitle: e.otherTitle }] }
    case 'usage':
      return {
        ...v,
        cost: e.usage.totalCostUsd,
        tokens: e.usage.inputTokens + e.usage.outputTokens,
      }
    default:
      return v
  }
}

export const baseName = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path

export const formatTokens = (tokens: number): string =>
  tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)

export function toolSummary(name: string, input: unknown): string {
  const value = (input ?? {}) as Record<string, unknown>
  const pick = (key: string): string | undefined =>
    typeof value[key] === 'string' ? (value[key] as string) : undefined
  return (
    pick('command') ??
    pick('file_path') ??
    pick('notebook_path') ??
    pick('pattern') ??
    pick('url') ??
    pick('query') ??
    pick('description') ??
    JSON.stringify(value).slice(0, 120)
  )
}

export const timeLabel = (ms: number): string =>
  new Date(ms).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

export const clampArtifactWidth = (width: number): number =>
  Math.max(280, Math.min(760, Math.round(width)))

const MIN_TAB = 116
const TAB_RESERVE = 44

export function splitSessionTabs(
  sessions: StoredSession[],
  activeId: string | undefined,
  room: number,
): { visible: StoredSession[]; overflow: StoredSession[] } {
  const fit = Math.max(1, Math.floor((room - TAB_RESERVE) / MIN_TAB))
  if (room === 0 || sessions.length <= fit) return { visible: sessions, overflow: [] }

  let visible = sessions.slice(0, fit)
  if (activeId && !visible.some((session) => session.id === activeId)) {
    const active = sessions.find((session) => session.id === activeId)
    if (active) visible = [...sessions.slice(0, fit - 1), active]
  }
  const shown = new Set(visible.map((session) => session.id))
  return { visible, overflow: sessions.filter((session) => !shown.has(session.id)) }
}
