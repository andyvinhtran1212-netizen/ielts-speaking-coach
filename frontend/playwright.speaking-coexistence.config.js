// Manual Gate E Speaking coexistence/rollback drill against live staging.
// Each dispatch runs one phase after the operator deploys that phase's commit.
// The three artifacts are chained by the session id emitted by the prior run.
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/speaking-coexistence-drill',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [
    ['github'],
    ['json', { outputFile: 'test-results/gate-e-speaking-coexistence-results.json' }],
    ['html', { open: 'never' }],
  ],
  use: {
    baseURL: process.env.STAGING_BASE_URL || 'https://staging.averlearning.com',
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    // This live drill sends bearer + Vercel-bypass credentials. Playwright
    // traces/screenshots are deliberately disabled so failure artifacts cannot
    // retain reusable request headers or authenticated page state.
    screenshot: 'off',
    trace: 'off',
  },
});
