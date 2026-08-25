// Gate E Listening failure matrix — deterministic canonical-persistence faults.
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/gate-e-listening',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  outputDir: 'test-results/gate-e-listening',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/gate-e-listening', open: 'never' }],
    ['json', { outputFile: 'test-results/gate-e-listening-device-matrix-results.json' }],
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3213/listening/test/session?id=LIS-GATE-E-1',
    env: { PORT: '3213' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
  use: {
    baseURL: 'http://localhost:3213',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'gate-e-listening-chromium-desktop',
      use: { browserName: 'chromium' },
    },
    {
      name: 'gate-e-listening-webkit-desktop',
      use: { browserName: 'webkit' },
    },
    {
      name: 'gate-e-listening-webkit-iphone13',
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
  ],
});
