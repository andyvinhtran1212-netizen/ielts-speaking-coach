const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/reading-native',
  testMatch: 'review-correction-desk.spec.js',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/review-redesign',
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3211/reading/review',
    env: { PORT: '3211' },
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:3211',
    browserName: 'chromium',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
