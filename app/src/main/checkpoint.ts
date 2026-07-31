import type { CheckpointDraft, GitSnapshot, SessionEvent } from '@shared/session'
import * as db from './db'
import { changedSince } from './git'

/**
 * Checkpoint — 세션을 그대로 이어갈 수 없을 때 작업 상태를 넘긴다(기획서 17장).
 *
 * Resume 과 다른 점: **세션 ID 가 아니라 텍스트를 넘긴다.** 세션 기록은 러너 홈마다
 * 따로 있어(WSL ~/.claude · Windows %USERPROFILE% · Codex ~/.codex) ID 는 경계를 못 넘는다.
 * 텍스트로 뜨면 Claude→Codex, WSL→Windows, 에이전트 A→B 가 전부 같은 경로로 풀린다.
 *
 * **전체 대화를 옮기지 않는다.** 지시·변경 파일·산출물처럼 다음 사람이 실제로
 * 필요로 하는 것만 추린다. 대화를 통째로 넣으면 새 세션의 컨텍스트만 잡아먹는다.
 *
 * 여기서는 앱이 아는 사실만 조립한다. "무엇이 남았는지"는 모델이 아니라
 * 사용자가 채운다 — 앱이 지어내면 틀린 인계가 된다.
 */

export async function build(sessionId: string): Promise<CheckpointDraft | undefined> {
  const session = db.getSession(sessionId)
  if (!session) return undefined

  const events = db.listEvents(sessionId).map((e) => e.event as SessionEvent)
  const snapshot = db.getSnapshot(sessionId) as GitSnapshot | undefined

  const instructions = events
    .filter((e): e is Extract<SessionEvent, { t: 'message' }> => e.t === 'message')
    .filter((e) => e.role === 'user')
    .map((e) => e.text.split('\n')[0].slice(0, 200))

  // 마지막 응답은 대개 "무엇을 했는지" 요약이라 인계에 가장 쓸모 있다
  const lastAnswer = [...events]
    .reverse()
    .find(
      (e): e is Extract<SessionEvent, { t: 'message' }> =>
        e.t === 'message' && e.role === 'assistant' && !e.isError,
    )?.text

  const tools = events.filter((e) => e.t === 'tool-use') as Extract<
    SessionEvent,
    { t: 'tool-use' }
  >[]
  const failed = new Set(
    events
      .filter((e): e is Extract<SessionEvent, { t: 'tool-result' }> => e.t === 'tool-result')
      .filter((e) => !e.ok)
      .map((e) => e.toolUseId),
  )

  const artifacts = events
    .filter((e): e is Extract<SessionEvent, { t: 'artifact' }> => e.t === 'artifact')
    .map((e) => e.path)
    .filter((p): p is string => !!p)

  let changed: { path: string; status: string }[] = []
  const workPath = session.worktree?.path ?? session.projectPath
  if (snapshot) {
    try {
      changed = await changedSince(workPath, snapshot)
    } catch {
      changed = db.listFileChanges(sessionId).map((path) => ({ path, status: '?' }))
    }
  } else {
    changed = db.listFileChanges(sessionId).map((path) => ({ path, status: '?' }))
  }

  const lines: string[] = [
    '# 이어받는 작업',
    '',
    `이전 세션: ${session.title ?? '(제목 없음)'}`,
    `작업 위치: ${workPath}`,
  ]
  if (session.worktree) lines.push(`원래 프로젝트: ${session.projectPath}`)
  if (snapshot) lines.push(`기준 커밋: ${snapshot.branch} @ ${snapshot.head}`)

  lines.push('', '## 무엇을 지시했나', '')
  lines.push(...(instructions.length ? instructions.map((t) => `- ${t}`) : ['- (기록 없음)']))

  if (lastAnswer) {
    lines.push('', '## 직전 세션이 마지막으로 보고한 것', '')
    lines.push(trim(lastAnswer, 1200))
  }

  lines.push('', '## 바뀐 파일', '')
  lines.push(
    ...(changed.length
      ? changed.map((c) => `- \`${c.path}\` (${c.status})`)
      : ['- (없음)']),
  )

  if (artifacts.length) {
    lines.push('', '## 산출물', '')
    lines.push(...[...new Set(artifacts)].map((p) => `- \`${p}\``))
  }

  const failedTools = tools.filter((t) => failed.has(t.toolUseId))
  if (failedTools.length) {
    lines.push('', '## 실패한 작업', '')
    lines.push(...failedTools.slice(-5).map((t) => `- ${t.name} — ${summarize(t.input)}`))
  }

  lines.push(
    '',
    '## 남은 일',
    '',
    '- (여기에 이어서 할 일을 적어주세요)',
    '',
    '---',
    '',
    '위 내용을 확인하고 이어서 작업해줘. 모르는 부분은 파일을 직접 확인하고,',
    '추측으로 진행하지 말고 물어봐.',
  )

  return {
    sessionId,
    title: session.title ?? '',
    projectPath: session.projectPath,
    body: lines.join('\n'),
  }
}

function trim(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max)}\n\n… (이하 생략)`
}

function summarize(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const pick = (k: string): string | undefined =>
    typeof i[k] === 'string' ? (i[k] as string) : undefined
  return (pick('command') ?? pick('file_path') ?? pick('description') ?? '').slice(0, 100)
}
