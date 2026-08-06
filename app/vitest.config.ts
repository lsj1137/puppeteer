import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // worktree 통합 테스트는 Git 프로세스를 여러 번 띄운다. Windows의 첫 실행과
    // 실시간 검사 환경에서는 기본 5초를 넘을 수 있지만, 실제 hang은 계속 제한한다.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
})
