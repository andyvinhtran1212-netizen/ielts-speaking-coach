// Manual live Listening floor/cutover/rollback drill against staging.
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/listening-coexistence-drill',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [
    ['github'],
    ['json', { outputFile: 'test-results/gate-e-listening-coexistence-results.json' }],
  ],
  use: {
    baseURL: process.env.STAGING_BASE_URL || 'https://staging.averlearning.com',
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    screenshot: 'off',
    trace: 'off',
  },
});

