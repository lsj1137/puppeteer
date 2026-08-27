import type { ReportFacts, SessionEvent, StoredSession } from '@shared/session'
import * as db from './db'

/**
 * 기간 보고서 — 고른 기간의 세션을 모아 «무엇을 했나» 를 정리한다.
 *
 * `checkpoint.ts` 와 뽑는 소스는 같고 조립만 다르다. 인계용은 «남은 일» 과
 * «이어서 작업해줘» 가 붙지만 보고용은 지난 일만 담는다.
 *
 * **앱은 사실만 모은다.** 문장으로 다듬는 것은 모델이 하고, 그 근거를 사용자가
 * 나란히 볼 수 있어야 한다. 앱이 «무엇을 했는지» 를 지어내면 틀린 보고가 된다.
 */

/** 세션 하나에서 뽑을 양. 넘치면 모델이 앞부분만 보고 뒤를 지어낸다. */
const MAX_INSTRUCTIONS = 5
const INSTRUCTION_CHARS = 200
const ANSWER_CHARS = 500
const MAX_FILES = 10
/** 번들 전체 상한. 넘으면 오래된 세션부터 한 줄로 줄인다. */
const BUNDLE_CHARS = 60_000

interface SessionFacts {
  session: StoredSession
  instructions: string[]
  lastAnswer?: string
  changedFiles: string[]
  artifacts: string[]
}

const trim = (text: string, max: number): string => {
  const t = text.trim().replace(/\s+$/, '')
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

const dateLabel = (ms: number): string => {
  const d = new Date(ms)
  const week = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${week}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

function collect(session: StoredSession): SessionFacts {
  const events = db.listEvents(session.id).map((e) => e.event as SessionEvent)

  const instructions = events
    .filter((e): e is Extract<SessionEvent, { t: 'message' }> => e.t === 'message')
    .filter((e) => e.role === 'user')
    .map((e) => trim(e.text.split('\n')[0], INSTRUCTION_CHARS))
    .slice(0, MAX_INSTRUCTIONS)

  // 마지막 응답은 대개 «무엇을 했는지» 요약이라 보고에 가장 쓸모 있다.
  // 실패 응답은 «무엇을 했다» 가 아니므로 뺀다.
  const lastAnswer = [...events]
    .reverse()
    .find(
      (e): e is Extract<SessionEvent, { t: 'message' }> =>
        e.t === 'message' && e.role === 'assistant' && !e.isError,
    )?.text

  const artifacts = [
    ...new Set(
      events
        .filter((e): e is Extract<SessionEvent, { t: 'artifact' }> => e.t === 'artifact')
        .map((e) => e.path)
        .filter((p): p is string => !!p),
    ),
  ]

  return {
    session,
    instructions,
    lastAnswer: lastAnswer ? trim(lastAnswer, ANSWER_CHARS) : undefined,
    changedFiles: db.listFileChanges(session.id),
    artifacts,
  }
}

/** 세션 한 건을 온전히 적는다. */
function full(f: SessionFacts): string {
  const s = f.session
  const lines = [
    `### ${s.title || '(제목 없음)'}`,
    '',
    `- 프로젝트: ${baseName(s.projectPath)}`,
    `- 시각: ${dateLabel(s.startedAt)}${s.endedAt ? ` – ${dateLabel(s.endedAt)}` : ''}`,
    `- 상태: ${s.status}${s.agentName ? ` · Agent ${s.agentName}` : ''}${s.hidden ? ' · 숨김' : ''}`,
  ]
  if (s.costUsd > 0) lines.push(`- 비용: $${s.costUsd.toFixed(4)}`)

  if (f.instructions.length) {
    lines.push('', '지시:')
    lines.push(...f.instructions.map((t) => `- ${t}`))
  }
  if (f.lastAnswer) {
    lines.push('', '마지막 보고:', '', f.lastAnswer)
  }
  if (f.changedFiles.length) {
    lines.push('', `바뀐 파일 ${f.changedFiles.length}개:`)
    lines.push(...f.changedFiles.slice(0, MAX_FILES).map((p) => `- \`${p}\``))
    if (f.changedFiles.length > MAX_FILES) {
      lines.push(`- … 외 ${f.changedFiles.length - MAX_FILES}개`)
    }
  }
  if (f.artifacts.length) {
    lines.push('', `산출물: ${f.artifacts.map((p) => `\`${p}\``).join(', ')}`)
  }
  return lines.join('\n')
}

/** 상한을 넘겼을 때 남기는 한 줄. */
function brief(f: SessionFacts): string {
  const s = f.session
  return `- ${dateLabel(s.startedAt)} · ${baseName(s.projectPath)} · ${s.title || '(제목 없음)'}`
}

/**
 * 세션들을 Markdown 사실 번들로 만든다.
 *
 * 상한을 넘으면 **오래된 것부터** 한 줄로 줄인다. 최근 것이 보고에서 더 중요하다.
 * 무엇이 줄었는지는 번들 앞머리에 적는다 — 조용히 빠지면 틀린 보고가 된다.
 */
export function buildFacts(sessions: StoredSession[], rangeLabel: string): ReportFacts {
  const totalCostUsd = sessions.reduce((sum, s) => sum + s.costUsd, 0)
  if (sessions.length === 0) {
    return {
      text: `# 작업 기록\n\n기간: ${rangeLabel}\n\n이 기간에 세션이 없습니다.`,
      sessionCount: 0,
      trimmedCount: 0,
      totalCostUsd: 0,
    }
  }

  // 최근 것부터 온전히 적다가 예산이 떨어지면 나머지는 한 줄로 돌린다
  const ordered = [...sessions].sort((a, b) => b.startedAt - a.startedAt)
  const facts = ordered.map(collect)
  const detailed: string[] = []
  const trimmed: string[] = []
  let used = 0
  for (const f of facts) {
    const block = full(f)
    if (used + block.length <= BUNDLE_CHARS) {
      detailed.push(block)
      used += block.length
    } else {
      trimmed.push(brief(f))
    }
  }

  const head = [
    '# 작업 기록',
    '',
    `기간: ${rangeLabel}`,
    `세션: ${sessions.length}건`,
    ...(totalCostUsd > 0 ? [`비용: $${totalCostUsd.toFixed(3)}`] : []),
  ]
  if (trimmed.length) {
    head.push(
      '',
      `> 분량이 많아 오래된 ${trimmed.length}건은 제목만 남겼습니다. 그 항목은 «목록만 있는 세션» 에 있습니다.`,
    )
  }

  const body = ['', '## 세션', '', detailed.join('\n\n')]
  if (trimmed.length) {
    body.push('', '## 목록만 있는 세션', '', trimmed.join('\n'))
  }

  return {
    text: [...head, ...body].join('\n'),
    sessionCount: sessions.length,
    trimmedCount: trimmed.length,
    totalCostUsd,
  }
}

/** 사용자 프롬프트와 사실 번들을 하나의 지시로 합친다. */
export function buildPrompt(userPrompt: string, facts: string): string {
  return [
    userPrompt.trim(),
    '',
    '---',
    '',
    '아래는 위 요청에 쓸 **실제 작업 기록**이다.',
    '',
    '규칙:',
    '- 기록에 없는 내용을 지어내지 마라. 모르면 적지 마라.',
    '- 도구를 쓰지 마라. 파일을 읽지 마라. 아래 기록만 보고 쓴다.',
    '- 결과는 Markdown 본문만 출력한다. 인사말이나 «작성했습니다» 같은 말을 붙이지 마라.',
    '',
    facts,
  ].join('\n')
}
