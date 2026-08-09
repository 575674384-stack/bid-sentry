import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 12_000
  },
  reporter: [['line']],
  outputDir: 'test-results/e2e',
  use: {
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
})
