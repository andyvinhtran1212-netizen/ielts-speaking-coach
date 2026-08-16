// Gate E Reading failure matrix — deterministic canonical-persistence faults.
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/gate-e-reading',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  outputDir: 'test-results/gate-e-reading',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/gate-e-reading', open: 'never' }],
    ['json', { outputFile: 'test-results/gate-e-reading-device-matrix-results.json' }],
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3212/reading/exam/session?test_id=RD-GATE-E-1',
    env: { PORT: '3212' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
  use: {
    baseURL: 'http://localhost:3212',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'gate-e-reading-chromium-desktop',
      use: { browserName: 'chromium' },
    },
    {
      name: 'gate-e-reading-webkit-desktop',
      use: { browserName: 'webkit' },
    },
    {
      name: 'gate-e-reading-webkit-iphone13',
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
  ],
});
