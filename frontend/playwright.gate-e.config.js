// Gate E Speaking browser fixtures — native App Router player only.
//
// This suite deliberately has its own config/testDir. The legacy fixture
// smoke tests use a static server; Gate E must exercise the hydrated Next
// route, React-owned state store and authenticated bootstrap together.
//
// Run: npm run test:e2e:gate-e
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const MIC_SPEC = /native-speaking-device-mic\.spec\.js/;
const WEBKIT_CAPABILITY_SPEC = /native-speaking-webkit-capability\.spec\.js/;
const IS_LINUX_CI = process.platform === 'linux' && Boolean(process.env.CI);

module.exports = defineConfig({
  testDir: './tests/gate-e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  outputDir: 'test-results/gate-e',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/gate-e', open: 'never' }],
    ['json', { outputFile: 'test-results/gate-e-speaking-device-matrix-results.json' }],
  ],
  webServer: {
    // Build once and exercise the production server. This removes Next dev's
    // first-request compilation from the evidence path without masking product
    // failures behind a Playwright retry.
    command: 'npm run build && npm run start',
    // Dedicated port + no reuse: port 3000 is commonly occupied by another
    // local project, and reusing it would let this suite test the wrong app.
    url: 'http://localhost:3210/practice/session',
    env: { PORT: '3210' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
  use: {
    baseURL: 'http://localhost:3210',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'gate-e-chromium-desktop',
      testIgnore: WEBKIT_CAPABILITY_SPEC,
      // CI and local runs use the lockfile-matched bundled browser. A branded
      // system Chrome is not an implicit prerequisite for the documented run.
      use: { browserName: 'chromium' },
    },
    {
      name: 'gate-e-webkit-desktop',
      // Playwright WebKit on the pinned Linux CI runner has no MediaRecorder.
      // Do not project that runner-specific gap onto capable macOS WebKit runs.
      ...(IS_LINUX_CI ? { testIgnore: MIC_SPEC } : {}),
      use: {
        browserName: 'webkit',
      },
    },
    {
      name: 'gate-e-webkit-iphone13',
      ...(IS_LINUX_CI ? { testIgnore: MIC_SPEC } : {}),
      use: {
        ...devices['iPhone 13'],
        browserName: 'webkit',
      },
    },
  ],
});
