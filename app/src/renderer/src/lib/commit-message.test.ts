import { describe, expect, it } from 'vitest'
import { generateCommitMessage } from './commit-message'

describe('generateCommitMessage', () => {
  it('describes an extracted hook and includes changed files in the body', () => {
    const result = generateCommitMessage(`diff --git a/app/src/App.tsx b/app/src/App.tsx
--- a/app/src/App.tsx
+++ b/app/src/App.tsx
-const old = true
+const next = true
diff --git a/app/src/hooks/use-session-views.ts b/app/src/hooks/use-session-views.ts
new file mode 100644
--- /dev/null
+++ b/app/src/hooks/use-session-views.ts
+export function useSessionViews() {}`)

    expect(result.subject).toBe('refactor: use-session-views 훅 분리')
    expect(result.body).toContain('- app/src/hooks/use-session-views.ts 추가 (+1/-0)')
  })

  it('falls back safely when the diff is empty', () => {
    expect(generateCommitMessage('').value).toBe('chore: 작업 변경 반영')
  })

  it('excludes changes that were already committed on the worktree branch', () => {
    const result = generateCommitMessage(`diff --git a/old.ts b/old.ts
--- a/old.ts
+++ b/old.ts
+already committed

# 커밋되지 않은 tracked 변경
diff --git a/current.ts b/current.ts
--- a/current.ts
+++ b/current.ts
+pending`)

    expect(result.body).toEqual(['- current.ts 수정 (+1/-0)'])
  })
})
