export const MEMORY_PROPOSAL_INSTRUCTION = `Memory에 장기적으로 남길 가치가 있는 안정적인 사실이나 사용자 선호를 발견한 경우에만 응답 끝에 아래 블록을 추가하세요. 일회성 작업 상태, 비밀, 추측은 제안하지 마세요. 블록은 사용자에게 보이지 않고 앱의 검토함으로 전달됩니다.
\`\`\`memory-proposal
{"scope":"project","content":"추가할 간결한 Markdown","reason":"왜 계속 기억할 가치가 있는지"}
\`\`\`
scope는 project 또는 agent입니다. Global Memory는 사용자가 직접 관리하므로 제안하지 마세요. agent는 현재 전용 에이전트가 있을 때만 사용하세요. 이 신호는 제안일 뿐이며 직접 Memory 파일을 수정하지 마세요.`

export interface ParsedMemoryProposal {
  scope: 'project' | 'agent'
  content: string
  reason: string
}

const BLOCK = /```memory-proposal\s*\n([\s\S]*?)```/gi

/** 구조화 블록을 걷어내고 유효한 제안만 반환한다. 잘못된 신호는 일반 텍스트로 남긴다. */
export function extractMemoryProposals(text: string): {
  text: string
  proposals: ParsedMemoryProposal[]
} {
  const proposals: ParsedMemoryProposal[] = []
  const cleaned = text.replace(BLOCK, (whole, body: string) => {
    try {
      const value = JSON.parse(body.trim()) as Record<string, unknown>
      if (!['project', 'agent'].includes(String(value.scope))) return whole
      if (typeof value.content !== 'string' || !value.content.trim()) return whole
      if (typeof value.reason !== 'string' || !value.reason.trim()) return whole
      proposals.push({
        scope: value.scope as ParsedMemoryProposal['scope'],
        content: value.content.trim(),
        reason: value.reason.trim(),
      })
      return ''
    } catch {
      return whole
    }
  })
  return { text: cleaned.trimEnd(), proposals }
}
