// Gate E Writing failure matrix — deterministic canonical-persistence faults.
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/gate-e-writing',
  timeout: 50_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  outputDir: 'test-results/gate-e-writing',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/gate-e-writing', open: 'never' }],
    ['json', { outputFile: 'test-results/gate-e-writing-device-matrix-results.json' }],
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3214/writing/dashboard',
    env: { PORT: '3214' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
  use: {
    baseURL: 'http://localhost:3214',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'gate-e-writing-chromium-desktop', use: { browserName: 'chromium' } },
    { name: 'gate-e-writing-webkit-desktop', use: { browserName: 'webkit' } },
    { name: 'gate-e-writing-webkit-iphone13', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
