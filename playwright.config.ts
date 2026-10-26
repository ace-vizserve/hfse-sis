import { defineConfig, devices } from '@playwright/test';

// Browser tests for the parent portal features the SIS serves (report card +
// absence/travel declarations). They drive the REAL portal (the sibling repo
// `../app-online-admission`) and the REAL SIS together, so both must already be
// running — see e2e/README.md. Nothing here is part of `npm test` (vitest only
// reads `__tests__/`).
export default defineConfig({
  testDir: './e2e',
  // One shared parent + one shared approver chain: the steps are a story, not
  // independent cases, so they run in order on one worker.
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'e2e/.report' }],
  ],
  outputDir: 'e2e/.results',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'on',
    // `next dev` compiles a route on its first hit, which can take a while.
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
});
