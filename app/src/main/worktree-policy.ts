/** 새 세션은 기본 격리하되, 기존 대화의 작업 위치는 중간에 바꾸지 않는다. */
export function shouldCreateWorktree(requested: boolean | undefined, isContinuation: boolean): boolean {
  return !isContinuation && requested !== false
}
