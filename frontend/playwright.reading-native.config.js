const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/reading-native',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3211/reading/exam/session?test_id=RD-NATIVE-1',
    env: { PORT: '3211' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:3211',
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
