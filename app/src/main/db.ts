import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  MemoryEdit,
  SessionWorktree,
  ApprovalDecision,
  ApprovalRequest,
  SessionEvent,
  SessionStatus,
  StoredEvent,
  ProjectStat,
  StoredProject,
  StoredSession,
} from '@shared/session'

/**
 * Node 24 내장 node:sqlite 를 쓴다.
 * better-sqlite3 는 네이티브 빌드가 필요한데, TLS 검사 프록시(SELF_SIGNED_CERT_IN_CHAIN)로
 * Electron 헤더 다운로드가 막히고 C++ 빌드 도구도 없어 리빌드가 불가능했다.
 */
let db: DatabaseSync
const APPROVAL_STALE_MS = 5 * 60 * 1000

export function openDb(): void {
  db = new DatabaseSync(join(app.getPath('userData'), 'workspace.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate()
}

function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project (
      path         TEXT PRIMARY KEY,
      runner_id    TEXT,
      added_at     INTEGER NOT NULL,
      last_used_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS session (
      id             TEXT PRIMARY KEY,
      project_path   TEXT NOT NULL,
      cli_session_id TEXT,
      runner_id      TEXT,
      title          TEXT,
      status         TEXT NOT NULL,
      cost_usd       REAL NOT NULL DEFAULT 0,
      started_at     INTEGER NOT NULL,
      ended_at       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_session_project
      ON session(project_path, started_at DESC);

    CREATE TABLE IF NOT EXISTS event (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      t          TEXT NOT NULL,
      payload    TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_session ON event(session_id, id);

    CREATE TABLE IF NOT EXISTS approval (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tool       TEXT NOT NULL,
      input      TEXT NOT NULL,
      cwd        TEXT,
      risk       TEXT NOT NULL,
      decision   TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_approval_session ON approval(session_id, created_at);

    CREATE TABLE IF NOT EXISTS file_change (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      path       TEXT NOT NULL,
      changed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_file_change_session ON file_change(session_id);
    CREATE INDEX IF NOT EXISTS idx_file_change_path ON file_change(path);

    -- Memory 변경 이력. 파일 자체는 CLI 가 읽는 정본이라 건드리지 않고,
    -- "언제 누가 얼마나 고쳤는지"만 앱이 따로 남긴다(기획서 11장).
    CREATE TABLE IF NOT EXISTS memory_edit (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id TEXT NOT NULL,
      bytes    INTEGER NOT NULL,
      at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_edit_entry ON memory_edit(entry_id);
  `)

  addColumn('session', 'snapshot', 'TEXT')
  addColumn('session', 'agent_name', 'TEXT')
  addColumn('session', 'worktree', 'TEXT')
}

/** SQLite 는 ADD COLUMN IF NOT EXISTS 가 없어 직접 확인한다 */
function addColumn(table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>
  if (cols.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

const now = (): number => Date.now()

// ── 프로젝트 ────────────────────────────────────────────────

export function listProjects(): StoredProject[] {
  return db
    .prepare(
      `SELECT path, runner_id AS runnerId, added_at AS addedAt, last_used_at AS lastUsedAt
       FROM project ORDER BY COALESCE(last_used_at, added_at) DESC`,
    )
    .all() as unknown as StoredProject[]
}

export function addProject(path: string): void {
  db.prepare(
    `INSERT INTO project (path, added_at, last_used_at) VALUES (?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET last_used_at = excluded.last_used_at`,
  ).run(path, now(), now())
}

export function removeProject(path: string): void {
  db.prepare('DELETE FROM project WHERE path = ?').run(path)
}

export function setProjectRunner(path: string, runnerId: string): void {
  db.prepare('UPDATE project SET runner_id = ?, last_used_at = ? WHERE path = ?').run(
    runnerId,
    now(),
    path,
  )
}

export function touchProject(path: string): void {
  db.prepare('UPDATE project SET last_used_at = ? WHERE path = ?').run(now(), path)
}

// ── 세션 ────────────────────────────────────────────────────

export function createSession(s: {
  id: string
  projectPath: string
  runnerId: string
  title: string
  agentName?: string
}): void {
  db.prepare(
    `INSERT INTO session (id, project_path, runner_id, title, agent_name, status, started_at)
     VALUES (?, ?, ?, ?, ?, 'starting', ?)`,
  ).run(s.id, s.projectPath, s.runnerId, s.title, s.agentName ?? null, now())
}

export function updateSession(
  id: string,
  patch: { status?: SessionStatus; cliSessionId?: string; costUsd?: number; ended?: boolean },
): void {
  if (patch.status) db.prepare('UPDATE session SET status = ? WHERE id = ?').run(patch.status, id)
  if (patch.cliSessionId)
    db.prepare('UPDATE session SET cli_session_id = ? WHERE id = ?').run(patch.cliSessionId, id)
  if (patch.costUsd !== undefined)
    db.prepare('UPDATE session SET cost_usd = ? WHERE id = ?').run(patch.costUsd, id)
  if (patch.ended) db.prepare('UPDATE session SET ended_at = ? WHERE id = ?').run(now(), id)
}

export function listSessions(projectPath: string, limit = 50): StoredSession[] {
  return db
    .prepare(
      `SELECT id, project_path AS projectPath, cli_session_id AS cliSessionId,
              runner_id AS runnerId, title, agent_name AS agentName, status,
              cost_usd AS costUsd, started_at AS startedAt, ended_at AS endedAt, worktree
       FROM session WHERE project_path = ? ORDER BY started_at DESC LIMIT ?`,
    )
    .all(projectPath, limit)
    .map(hydrate) as unknown as StoredSession[]
}

export function getSession(id: string): StoredSession | undefined {
  const row = db
    .prepare(
      `SELECT id, project_path AS projectPath, cli_session_id AS cliSessionId,
              runner_id AS runnerId, title, agent_name AS agentName, status,
              cost_usd AS costUsd, started_at AS startedAt, ended_at AS endedAt, worktree
       FROM session WHERE id = ?`,
    )
    .get(id) as unknown as StoredSession | undefined
  return row ? (hydrate(row) as unknown as StoredSession) : undefined
}

/** worktree 는 TEXT 컬럼에 JSON 으로 넣는다. 읽을 때 되돌린다. */
function hydrate(row: unknown): unknown {
  const r = row as Record<string, unknown>
  if (typeof r.worktree === 'string') {
    try {
      r.worktree = JSON.parse(r.worktree)
    } catch {
      r.worktree = null
    }
  }
  return r
}

export function setWorktree(id: string, wt: SessionWorktree | null): void {
  db.prepare('UPDATE session SET worktree = ? WHERE id = ?').run(
    wt ? JSON.stringify(wt) : null,
    id,
  )
}

/** Overview 용 프로젝트별 집계 */
export function projectStats(): ProjectStat[] {
  return db
    .prepare(
      `SELECT p.path,
              p.runner_id                      AS runnerId,
              p.last_used_at                   AS lastUsedAt,
              COUNT(s.id)                      AS sessionCount,
              COALESCE(SUM(s.cost_usd), 0)     AS totalCostUsd,
              MAX(s.started_at)                AS lastSessionAt
       FROM project p
       LEFT JOIN session s ON s.project_path = p.path
       GROUP BY p.path
       ORDER BY COALESCE(MAX(s.started_at), p.last_used_at, p.added_at) DESC`,
    )
    .all() as unknown as ProjectStat[]
}

/** 프로젝트를 가리지 않는 최근 세션 */
export function recentSessions(limit = 20): StoredSession[] {
  return db
    .prepare(
      `SELECT id, project_path AS projectPath, cli_session_id AS cliSessionId,
              runner_id AS runnerId, title, status, cost_usd AS costUsd,
              started_at AS startedAt, ended_at AS endedAt
       FROM session ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit) as unknown as StoredSession[]
}

/** 오늘 / 이번 달 비용 */
export function costTotals(): { today: number; month: number; all: number } {
  const d = new Date()
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const one = (from?: number): number => {
    const row = (
      from === undefined
        ? db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS v FROM session')
        : db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS v FROM session WHERE started_at >= ?')
    ).get(...(from === undefined ? [] : [from])) as unknown as { v: number }
    return row?.v ?? 0
  }
  return { today: one(startOfDay), month: one(startOfMonth), all: one() }
}

/** 세션과 딸린 기록을 모두 지운다 */
export function deleteSession(id: string): void {
  db.prepare('DELETE FROM event WHERE session_id = ?').run(id)
  db.prepare('DELETE FROM approval WHERE session_id = ?').run(id)
  db.prepare('DELETE FROM file_change WHERE session_id = ?').run(id)
  db.prepare('DELETE FROM session WHERE id = ?').run(id)
}

// ── 이벤트 ──────────────────────────────────────────────────

export function appendEvent(sessionId: string, event: SessionEvent): void {
  db.prepare('INSERT INTO event (session_id, t, payload, created_at) VALUES (?, ?, ?, ?)').run(
    sessionId,
    event.t,
    JSON.stringify(event),
    now(),
  )
}

export function setSnapshot(sessionId: string, snapshot: unknown): void {
  db.prepare('UPDATE session SET snapshot = ? WHERE id = ?').run(JSON.stringify(snapshot), sessionId)
}

export function getSnapshot(sessionId: string): unknown {
  const row = db.prepare('SELECT snapshot FROM session WHERE id = ?').get(sessionId) as
    | { snapshot: string | null }
    | undefined
  return row?.snapshot ? JSON.parse(row.snapshot) : undefined
}

// ── 변경 파일 ────────────────────────────────────────────────

export function recordFileChange(sessionId: string, path: string): void {
  db.prepare('INSERT INTO file_change (session_id, path, changed_at) VALUES (?, ?, ?)').run(
    sessionId,
    path,
    now(),
  )
}

export function listFileChanges(sessionId: string): string[] {
  const rows = db
    .prepare('SELECT DISTINCT path FROM file_change WHERE session_id = ? ORDER BY path')
    .all(sessionId) as unknown as Array<{ path: string }>
  return rows.map((r) => r.path)
}

export function listEvents(sessionId: string): StoredEvent[] {
  const rows = db
    .prepare('SELECT id, payload, created_at AS createdAt FROM event WHERE session_id = ? ORDER BY id')
    .all(sessionId) as unknown as Array<{ id: number; payload: string; createdAt: number }>
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    event: JSON.parse(r.payload) as SessionEvent,
  }))
}

// ── 승인 ────────────────────────────────────────────────────

export function recordApproval(req: ApprovalRequest): void {
  db.prepare(
    `INSERT INTO approval (id, session_id, tool, input, cwd, risk, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(req.id, req.sessionId, req.tool, JSON.stringify(req.input), req.cwd, req.risk, now())
}

export function decideApproval(id: string, decision: ApprovalDecision): void {
  db.prepare('UPDATE approval SET decision = ?, decided_at = ? WHERE id = ?').run(
    decision,
    now(),
    id,
  )
}

/** 아직 결정되지 않은 승인 (Approval Inbox) */
export function listOpenApprovals(): ApprovalRequest[] {
  expireStaleApprovals()
  const rows = db
    .prepare(
      `SELECT id, session_id AS sessionId, tool, input, cwd, risk
       FROM approval WHERE decision IS NULL ORDER BY created_at`,
    )
    .all() as unknown as Array<Omit<ApprovalRequest, 'input' | 'pending'> & { input: string }>
  return rows.map((r) => ({ ...r, input: JSON.parse(r.input) as unknown, pending: true }))
}

function expireStaleApprovals(): void {
  db.prepare(
    `UPDATE approval
       SET decision = 'deny', decided_at = ?
     WHERE decision IS NULL AND created_at < ?`,
  ).run(now(), now() - APPROVAL_STALE_MS)
}

export function recordMemoryEdit(entryId: string, bytes: number): void {
  db.prepare('INSERT INTO memory_edit (entry_id, bytes, at) VALUES (?, ?, ?)').run(
    entryId,
    bytes,
    Date.now(),
  )
}

/** 최근 변경 이력. 한 항목만 볼 수도, 전체를 볼 수도 있다. */
export function memoryEdits(entryId?: string, limit = 20): MemoryEdit[] {
  const sql = entryId
    ? 'SELECT id, entry_id AS entryId, bytes, at FROM memory_edit WHERE entry_id = ? ORDER BY at DESC LIMIT ?'
    : 'SELECT id, entry_id AS entryId, bytes, at FROM memory_edit ORDER BY at DESC LIMIT ?'
  const args = entryId ? [entryId, limit] : [limit]
  return db.prepare(sql).all(...args) as unknown as MemoryEdit[]
}
