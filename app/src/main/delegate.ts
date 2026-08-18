/**
 * 멀티 Agent 위임 신호.
 *
 * Lead 가 구조화 블록으로 "이 일을 보조에게 맡기겠다"를 알리면 앱이 그 블록을 걷어내고
 * 보조 run 을 직접 실행한 뒤, 결과를 다음 턴 프롬프트로 Lead 에 돌려준다.
 * Claude 전용 하위 Agent 기능에 기대지 않으므로 Codex 에서도 같은 방식으로 동작한다.
 * 신호 규약은 `memory-proposal` 과 같은 모양이다.
 */

/** 한 턴에 띄울 수 있는 보조 run 수. 넘으면 자르되 몇 건을 버렸는지 알린다. */
export const MAX_SUB_RUNS = 3

/**
 * 보조 run 하나가 물고 있을 수 있는 최대 시간.
 * 넘기면 프로세스를 끊고 실패로 돌린다 — Lead 가 영원히 기다리면 대화가 멈춘 것처럼 보인다.
 */
export const SUB_RUN_TIMEOUT_MS = 10 * 60 * 1000

export const DELEGATE_INSTRUCTION = `조사·확인처럼 병렬로 나눌 수 있는 일이 있으면 직접 하지 말고 보조 Agent에게 위임할 수 있습니다. 위임하려면 응답 끝에 아래 블록을 추가하세요.
\`\`\`delegate
{"runs":[{"agent":"에이전트 이름 또는 생략","task":"보조가 할 일을 자세히"}]}
\`\`\`
- 블록은 사용자에게 보이지 않습니다. 위임할 때는 무엇을 맡겼는지 응답 본문에도 한 줄로 적으세요.
- 보조는 읽기 전용입니다. 파일 수정·명령 실행이 필요한 일은 위임하지 말고 직접 하세요.
- 한 번에 ${MAX_SUB_RUNS}개까지 위임할 수 있고 서로 동시에 실행됩니다. 서로의 결과에 의존하지 않도록 나누세요. 결과는 다음 턴에 전달되며, 그때 최종 답변을 하세요.
- agent는 사용할 수 있는 Agent 이름일 때만 적고, 마땅한 것이 없으면 생략하세요.
- 스스로 답할 수 있는 일은 위임하지 마세요.`

export interface ParsedDelegate {
  /** 적용할 Puppeteer Agent 이름. 없으면 역할 정본 없이 도는 보조 run 이다. */
  agent?: string
  task: string
}

export interface DelegateOutcome {
  agent?: string
  task: string
  ok: boolean
  summary: string
}

const BLOCK = /```delegate\s*\n([\s\S]*?)```/gi

/** 구조화 블록을 걷어내고 유효한 위임만 반환한다. 잘못된 신호는 일반 텍스트로 남긴다. */
export function extractDelegates(text: string): { text: string; delegates: ParsedDelegate[] } {
  const delegates: ParsedDelegate[] = []
  const cleaned = text.replace(BLOCK, (whole, body: string) => {
    try {
      const value = JSON.parse(body.trim()) as Record<string, unknown>
      if (!Array.isArray(value.runs)) return whole

      const parsed: ParsedDelegate[] = []
      for (const item of value.runs) {
        const run = item as Record<string, unknown>
        if (typeof run?.task !== 'string' || !run.task.trim()) continue
        const agent = typeof run.agent === 'string' && run.agent.trim() ? run.agent.trim() : undefined
        parsed.push({ agent, task: run.task.trim() })
      }
      // 하나도 못 건졌으면 신호로 보지 않고 원문을 남긴다.
      if (parsed.length === 0) return whole
      delegates.push(...parsed)
      return ''
    } catch {
      return whole
    }
  })
  return { text: cleaned.trimEnd(), delegates }
}

/** 보조 결과를 Lead 에게 돌려줄 다음 턴 프롬프트. 사용자 지시로 기록하지 않는다. */
export function buildDelegateResultPrompt(outcomes: DelegateOutcome[]): string {
  const blocks = outcomes.map((outcome, index) => {
    const who = outcome.agent ? `보조 ${index + 1} (${outcome.agent})` : `보조 ${index + 1}`
    const head = outcome.ok ? `${who} 완료` : `${who} 실패`
    return `## ${head}\n맡긴 일: ${outcome.task}\n\n${outcome.summary.trim() || '(반환된 내용 없음)'}`
  })

  return [
    '위임한 보조 Agent의 결과입니다. 이 메시지는 앱이 전달한 것이며 사용자가 쓴 것이 아닙니다.',
    ...blocks,
    '이 결과를 반영해 사용자에게 최종 답변을 하세요. 확인되지 않은 내용은 확인되지 않았다고 밝히고, 실패한 보조가 있으면 그 사실도 알리세요.',
  ].join('\n\n')
}
