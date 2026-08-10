import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  MemoryEdit,
  MemoryProposal,
  SessionWorktree,
  ApprovalDecision,
  ApprovalRequest,
  SessionEvent,
  SessionStatus,
  StoredEvent,
  ProjectStat,
  StoredProject,
  StoredSession,
  WorktreeIntegrationReport,
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
      alias        TEXT,
      runner_id    TEXT,
      added_at     INTEGER NOT NULL,
      last_used_at INTEGER,
      sort_order   INTEGER
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

    -- 제안은 정본 Memory와 분리한다. approved가 되기 전에는 파일에 쓰지 않는다.
    CREATE TABLE IF NOT EXISTS memory_proposal (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      entry_id   TEXT NOT NULL,
      scope      TEXT NOT NULL,
      content    TEXT NOT NULL,
      reason     TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS app_setting (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS worktree_integration (
      session_id TEXT PRIMARY KEY,
      report     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_proposal_status
      ON memory_proposal(status, created_at DESC);
  `)

  addColumn('session', 'snapshot', 'TEXT')
  addColumn('session', 'agent_name', 'TEXT')
  addColumn('session', 'worktree', 'TEXT')
  addColumn('session', 'worktree_cleaned', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('session', 'sort_order', 'INTEGER')
  addColumn('session', 'hidden', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('project', 'sort_order', 'INTEGER')
  addColumn('project', 'alias', 'TEXT')
  db.exec(`
    WITH ranked AS (
      SELECT path, ROW_NUMBER() OVER (ORDER BY COALESCE(last_used_at, added_at) DESC) - 1 AS position
      FROM project
    )
    UPDATE project
    SET sort_order = (SELECT position FROM ranked WHERE ranked.path = project.path)
    WHERE sort_order IS NULL
  `)
  db.exec(`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY project_path ORDER BY started_at DESC) - 1 AS position
      FROM session
    )
    UPDATE session
    SET sort_order = (SELECT position FROM ranked WHERE ranked.id = session.id)
    WHERE sort_order IS NULL
  `)

  // 이전 버전에서 worktree를 정리하면 흔적이 모두 사라졌다. 생성 로그가 남은
  // 세션만 정리된 상태로 복구해, 재개 시 원본 폴더로 조용히 돌아가지 않게 한다.
  db.prepare(
    `UPDATE session
     SET worktree_cleaned = 1
     WHERE worktree IS NULL
       AND worktree_cleaned = 0
       AND EXISTS (
         SELECT 1 FROM event
         WHERE event.session_id = session.id
           AND event.t = 'artifact'
           AND event.payload LIKE '%격리 실행%'
       )`,
  ).run()
}

/** SQLite 는 ADD COLUMN IF NOT EXISTS 가 없어 직접 확인한다 */
function addColumn(table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>
  if (cols.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

const now = (): number => Date.now()

// ── 앱 설정 ─────────────────────────────────────────────────

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_setting (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

export function getWorktreeIntegration(sessionId: string): WorktreeIntegrationReport | undefined {
  try {
    const row = db.prepare('SELECT report FROM worktree_integration WHERE session_id = ?').get(
      sessionId,
    ) as { report: string } | undefined
    if (!row) return undefined
    return JSON.parse(row.report) as WorktreeIntegrationReport
  } catch {
    return undefined
  }
}

export function setWorktreeIntegration(
  sessionId: string,
  report: WorktreeIntegrationReport,
): boolean {
  try {
    db.prepare(
      `INSERT INTO worktree_integration (session_id, report) VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET report = excluded.report`,
    ).run(sessionId, JSON.stringify(report))
    return true
  } catch {
    // 진단 저장 실패가 실제 자동 커밋·병합을 막아서는 안 된다.
    return false
  }
}

// ── 프로젝트 ────────────────────────────────────────────────

export function listProjects(): StoredProject[] {
  return db
    .prepare(
      `SELECT path, alias, runner_id AS runnerId, added_at AS addedAt, last_used_at AS lastUsedAt,
              sort_order AS sortOrder
       FROM project
       ORDER BY sort_order IS NULL, sort_order ASC, COALESCE(last_used_at, added_at) DESC`,
    )
    .all() as unknown as StoredProject[]
}

export function addProject(path: string): void {
  db.prepare(
    `INSERT INTO project (path, added_at, last_used_at, sort_order)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM project))
     ON CONFLICT(path) DO UPDATE SET last_used_at = excluded.last_used_at`,
  ).run(path, now(), now())
}

export function reorderProjects(paths: string[]): void {
  const existing = listProjects().map(({ path }) => path)
  if (paths.length !== existing.length || new Set(paths).size !== paths.length) {
    throw new Error('프로젝트 순서가 현재 목록과 일치하지 않습니다.')
  }
  const known = new Set(existing)
  if (paths.some((path) => !known.has(path))) throw new Error('등록되지 않은 프로젝트가 포함되어 있습니다.')
  db.exec('BEGIN')
  try {
    const update = db.prepare('UPDATE project SET sort_order = ? WHERE path = ?')
    paths.forEach((path, index) => update.run(index, path))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function renameProject(path: string, alias: string): StoredProject | undefined {
  const normalized = alias.trim()
  db.prepare('UPDATE project SET alias = ? WHERE path = ?').run(normalized || null, path)
  return listProjects().find((project) => project.path === path)
}

export function projectWorktrees(path: string): SessionWorktree[] {
  const rows = db.prepare('SELECT worktree FROM session WHERE project_path = ? AND worktree IS NOT NULL')
    .all(path) as unknown as { worktree: string }[]
  return rows.flatMap(({ worktree }) => {
    try {
      return [JSON.parse(worktree) as SessionWorktree]
    } catch {
      return []
    }
  })
}

/** 프로젝트가 이동했을 때 기존 세션과 worktree의 원본 참조를 함께 바꾼다. */
export function relinkProject(oldPath: string, newPath: string): StoredProject {
  if (oldPath === newPath) {
    const current = listProjects().find((project) => project.path === oldPath)
    if (!current) throw new Error('등록된 프로젝트를 찾지 못했습니다.')
    return current
  }
  if (listProjects().some((project) => project.path === newPath)) {
    throw new Error('선택한 폴더는 이미 프로젝트로 등록되어 있습니다.')
  }

  const worktrees = projectWorktrees(oldPath)
  db.exec('BEGIN')
  try {
    db.prepare('UPDATE project SET path = ?, last_used_at = ? WHERE path = ?').run(newPath, now(), oldPath)
    db.prepare('UPDATE session SET project_path = ? WHERE project_path = ?').run(newPath, oldPath)
    const updateWorktree = db.prepare('UPDATE session SET worktree = ? WHERE worktree = ?')
    for (const worktree of worktrees) {
      updateWorktree.run(JSON.stringify({ ...worktree, origin: newPath }), JSON.stringify(worktree))
    }

    const oldMemoryPrefix = `file:${join(oldPath, 'AGENTS.md')}`
    const newMemoryPrefix = `file:${join(newPath, 'AGENTS.md')}`
    db.prepare('UPDATE memory_edit SET entry_id = ? WHERE entry_id = ?').run(newMemoryPrefix, oldMemoryPrefix)
    db.prepare('UPDATE memory_proposal SET entry_id = ? WHERE entry_id = ?').run(newMemoryPrefix, oldMemoryPrefix)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const project = listProjects().find((item) => item.path === newPath)
  if (!project) throw new Error('프로젝트 경로를 갱신하지 못했습니다.')
  return project
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
  const first = db.prepare(
    'SELECT COALESCE(MIN(sort_order), 0) - 1 AS position FROM session WHERE project_path = ?',
  ).get(s.projectPath) as { position: number }
  db.prepare(
    `INSERT INTO session
       (id, project_path, runner_id, title, agent_name, status, started_at, sort_order)
     VALUES (?, ?, ?, ?, ?, 'starting', ?, ?)`,
  ).run(s.id, s.projectPath, s.runnerId, s.title, s.agentName ?? null, now(), first.position)
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
              cost_usd AS costUsd, started_at AS startedAt, ended_at AS endedAt, worktree,
              worktree_cleaned AS worktreeCleaned, sort_order AS sortOrder, hidden
       FROM session WHERE project_path = ? AND hidden = 0
       ORDER BY sort_order ASC, started_at DESC LIMIT ?`,
    )
    .all(projectPath, limit)
    .map(hydrate) as unknown as StoredSession[]
}

export function getSession(id: string): StoredSession | undefined {
  const row = db
    .prepare(
      `SELECT id, project_path AS projectPath, cli_session_id AS cliSessionId,
              runner_id AS runnerId, title, agent_name AS agentName, status,
              cost_usd AS costUsd, started_at AS startedAt, ended_at AS endedAt, worktree,
              worktree_cleaned AS worktreeCleaned, sort_order AS sortOrder, hidden
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
  r.worktreeCleaned = Boolean(r.worktreeCleaned)
  r.hidden = Boolean(r.hidden)
  return r
}

export function setWorktree(id: string, wt: SessionWorktree | null): void {
  db.prepare('UPDATE session SET worktree = ?, worktree_cleaned = ? WHERE id = ?').run(
    wt ? JSON.stringify(wt) : null,
    wt ? 0 : 1,
    id,
  )
}

/** Overview 용 프로젝트별 집계 */
export function projectStats(): ProjectStat[] {
  return db
    .prepare(
      `SELECT p.path,
              p.alias,
              p.runner_id                      AS runnerId,
              p.last_used_at                   AS lastUsedAt,
              COUNT(s.id)                      AS sessionCount,
              COALESCE(SUM(s.cost_usd), 0)     AS totalCostUsd,
              MAX(s.started_at)                AS lastSessionAt
       FROM project p
       LEFT JOIN session s ON s.project_path = p.path
       GROUP BY p.path, p.alias
       ORDER BY COALESCE(MAX(s.started_at), p.last_used_at, p.added_at) DESC`,
    )
    .all() as unknown as ProjectStat[]
}

/** 프로젝트를 가리지 않는 최근 세션 */
export function recentSessions(limit = 20): StoredSession[] {
  return db
    .prepare(
      `SELECT id, project_path AS projectPath, cli_session_id AS cliSessionId,
              runner_id AS runnerId, title, agent_name AS agentName, status,
              cost_usd AS costUsd, started_at AS startedAt, ended_at AS endedAt,
              worktree, worktree_cleaned AS worktreeCleaned
       FROM session ORDER BY started_at DESC LIMIT ?`,
    )
    .all(limit)
    .map(hydrate) as unknown as StoredSession[]
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
  db.prepare('DELETE FROM worktree_integration WHERE session_id = ?').run(id)
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

export function listHiddenSessions(projectPath: string, limit = 50): StoredSession[] {
  return db.prepare(
    `SELECT id, project_path AS projectPath, cli_session_id AS cliSessionId,
            runner_id AS runnerId, title, agent_name AS agentName, status,
            cost_usd AS costUsd, started_at AS startedAt, ended_at AS endedAt, worktree,
            worktree_cleaned AS worktreeCleaned, sort_order AS sortOrder, hidden
     FROM session WHERE project_path = ? AND hidden = 1
     ORDER BY ended_at DESC, started_at DESC LIMIT ?`,
  ).all(projectPath, limit).map(hydrate) as unknown as StoredSession[]
}

export function reorderSessions(projectPath: string, ids: string[]): void {
  const visible = db.prepare(
    'SELECT id FROM session WHERE project_path = ? AND hidden = 0 ORDER BY sort_order ASC, started_at DESC LIMIT 50',
  ).all(projectPath) as unknown as Array<{ id: string }>
  if (visible.length !== ids.length || visible.some(({ id }) => !ids.includes(id))) {
    throw new Error('세션 순서가 최신 상태와 다릅니다. 목록을 새로고침한 뒤 다시 시도해 주세요.')
  }
  db.exec('BEGIN')
  try {
    const update = db.prepare('UPDATE session SET sort_order = ? WHERE id = ? AND project_path = ?')
    ids.forEach((id, index) => update.run(index, id, projectPath))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function setSessionHidden(id: string, hidden: boolean): StoredSession | undefined {
  db.prepare('UPDATE session SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id)
  return getSession(id)
}

export function renameSession(id: string, title: string): StoredSession | undefined {
  const next = title.trim().slice(0, 120)
  if (!next) throw new Error('세션 이름을 입력해 주세요.')
  db.prepare('UPDATE session SET title = ? WHERE id = ?').run(next, id)
  return getSession(id)
}

/** 수동 커밋·병합으로 해결된 과거 Worktree 검토 알림이 다시 나타나지 않게 정리한다. */
export function deleteWorktreeReviewNotices(sessionId: string): void {
  db.prepare(
    `DELETE FROM event
     WHERE session_id = ? AND t = 'notice'
       AND payload LIKE '%"title":"커밋·병합 검토 필요"%'`,
  ).run(sessionId)
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
      `SELECT a.id, a.session_id AS sessionId, s.project_path AS projectPath,
              a.tool, a.input, a.cwd, a.risk
       FROM approval a
       LEFT JOIN session s ON s.id = a.session_id
       WHERE a.decision IS NULL ORDER BY a.created_at`,
    )
    .all() as unknown as Array<Omit<ApprovalRequest, 'input' | 'pending'> & { input: string }>
  // 같은 메인 프로세스에서 렌더러만 새로고침됐을 수 있다. DB에 열려 있다면 broker도
  // 아직 응답 가능하므로 일반 승인 카드로 복원한다. 진짜 timeout은 onApproval에서 닫힌다.
  return rows.map((r) => ({ ...r, input: JSON.parse(r.input) as unknown, pending: false }))
}

/** 프로세스나 세션이 끝나 더는 응답할 수 없는 승인 요청을 닫는다. */
export function discardOpenApprovals(sessionId?: string): string[] {
  const where = sessionId ? 'decision IS NULL AND session_id = ?' : 'decision IS NULL'
  const args = sessionId ? [sessionId] : []
  const rows = db.prepare(`SELECT id FROM approval WHERE ${where}`).all(...args) as Array<{ id: string }>
  if (rows.length === 0) return []
  db.prepare(`UPDATE approval SET decision = 'deny', decided_at = ? WHERE ${where}`).run(
    now(),
    ...args,
  )
  return rows.map(({ id }) => id)
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

export function recordMemoryProposal(
  proposal: Pick<MemoryProposal, 'sessionId' | 'entryId' | 'scope' | 'content' | 'reason'>,
): MemoryProposal | undefined {
  const duplicate = db.prepare(
    `SELECT id FROM memory_proposal
     WHERE status = 'pending' AND entry_id = ? AND content = ? LIMIT 1`,
  ).get(proposal.entryId, proposal.content)
  if (duplicate) return undefined
  const createdAt = now()
  const inserted = db.prepare(
    `INSERT INTO memory_proposal
       (session_id, entry_id, scope, content, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    proposal.sessionId,
    proposal.entryId,
    proposal.scope,
    proposal.content,
    proposal.reason,
    createdAt,
  )
  const id = Number(inserted.lastInsertRowid)
  return { ...proposal, id, status: 'pending', createdAt }
}

export function memoryProposals(status: MemoryProposal['status'] = 'pending'): MemoryProposal[] {
  return db.prepare(
    `SELECT id, session_id AS sessionId, entry_id AS entryId, scope, content, reason,
            status, created_at AS createdAt, decided_at AS decidedAt
     FROM memory_proposal WHERE status = ? ORDER BY created_at DESC`,
  ).all(status) as unknown as MemoryProposal[]
}

export function getMemoryProposal(id: number): MemoryProposal | undefined {
  return db.prepare(
    `SELECT id, session_id AS sessionId, entry_id AS entryId, scope, content, reason,
            status, created_at AS createdAt, decided_at AS decidedAt
     FROM memory_proposal WHERE id = ?`,
  ).get(id) as unknown as MemoryProposal | undefined
}

export function decideMemoryProposal(id: number, status: 'approved' | 'rejected'): void {
  db.prepare(
    `UPDATE memory_proposal SET status = ?, decided_at = ?
     WHERE id = ? AND status = 'pending'`,
  ).run(status, now(), id)
}
