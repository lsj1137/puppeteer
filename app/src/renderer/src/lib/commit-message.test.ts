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

  it('uses the package version for a release bump', () => {
    const result = generateCommitMessage(`diff --git a/app/package.json b/app/package.json
--- a/app/package.json
+++ b/app/package.json
-  "version": "0.0.3",
+  "version": "0.0.4",`)

    expect(result.subject).toBe('chore: 버전 0.0.4로 갱신')
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

  it('treats new untracked source files as the feature even though they come last', () => {
    const result = generateCommitMessage(`# 커밋되지 않은 tracked 변경
diff --git a/app/src/main/index.ts b/app/src/main/index.ts
--- a/app/src/main/index.ts
+++ b/app/src/main/index.ts
+import { updateCli } from './cli-update'
diff --git a/app/src/renderer/src/components/SessionHeader.tsx b/app/src/renderer/src/components/SessionHeader.tsx
--- a/app/src/renderer/src/components/SessionHeader.tsx
+++ b/app/src/renderer/src/components/SessionHeader.tsx
+const a = 1
+const b = 2

# 새 파일 - 아직 git 에 추가되지 않음
+++ app/src/main/cli-update.test.ts
+++ app/src/main/cli-update.ts`)

    expect(result.subject).toBe('feat: cli-update 추가')
    expect(result.body).toContain('- 관련 회귀 테스트 보강')
  })

  it('picks the most changed source file and names index files by their folder', () => {
    const result = generateCommitMessage(`diff --git a/app/src/a.ts b/app/src/a.ts
--- a/app/src/a.ts
+++ b/app/src/a.ts
+one
diff --git a/app/src/main/index.ts b/app/src/main/index.ts
--- a/app/src/main/index.ts
+++ b/app/src/main/index.ts
+one
+two
-three`)

    expect(result.subject).toBe('refactor: main/index 개선')
  })

  it('keeps dotfile names when only config and docs changed', () => {
    const result = generateCommitMessage(`diff --git a/.gitignore b/.gitignore
--- a/.gitignore
+++ b/.gitignore
+out/
diff --git a/app/.gitignore b/app/.gitignore
--- a/app/.gitignore
+++ b/app/.gitignore
+dist/
diff --git a/docs/notes.md b/docs/notes.md
--- a/docs/notes.md
+++ b/docs/notes.md
+memo`)

    expect(result.subject).toBe('chore: .gitignore 외 2개 갱신')
  })
})
