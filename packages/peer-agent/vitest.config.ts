import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/cli.ts', 'src/cli/send.ts', 'src/mcp-registration.ts'],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 }
    }
  }
})
