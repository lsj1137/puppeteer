/**
 * Claude CLI 슬래시 명령(`/context`, `/code-review` 등).
 *
 * CLI 는 입력이 `/` 로 **시작할 때만** 명령으로 처리한다. 앞에 한 글자라도 붙으면 일반
 * 메시지로 모델에 넘어가 «명령으로 인식되지 않았다» 는 답만 받고 토큰을 쓴다.
 * `/home/user 봐줘` 같은 경로는 명령 이름 뒤가 공백이 아니라서 걸리지 않는다.
 */
const SLASH_COMMAND = /^\/[A-Za-z][\w:.-]*(\s|$)/

export function isSlashCommand(prompt: string): boolean {
  return SLASH_COMMAND.test(prompt.trimStart())
}

/** 입력 중인 명령 이름. 공백을 치기 전, 첫 토큰을 쓰는 동안에만 값이 있다. */
export function slashQuery(value: string): string | undefined {
  return value.match(/^\/([\w:.-]*)$/)?.[1]
}

/**
 * 자동완성 후보. 앞부분이 맞는 것을 먼저, 그다음 중간에 들어 있는 것을 보인다.
 * `__` 로 시작하는 CLI 내부 명령은 사용자가 고를 대상이 아니라 뺀다.
 */
export function matchSlashCommands(commands: string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase()
  const visible = [...new Set(commands)].filter((name) => !name.startsWith('__'))
  const prefix = visible.filter((name) => name.toLowerCase().startsWith(q))
  const contains = visible.filter((name) => !prefix.includes(name) && name.toLowerCase().includes(q))
  return [...prefix, ...contains].slice(0, limit)
}
