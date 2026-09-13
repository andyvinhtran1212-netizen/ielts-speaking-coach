// Speaking browser regression — native App Router player only.
//
// This suite deliberately has its own config/testDir. The legacy fixture
// smoke tests use a static server; this suite exercises the hydrated Next
// route, React-owned state store and authenticated bootstrap together.
//
// Run: npm run test:e2e:speaking-regression
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const MIC_SPEC = /native-speaking-device-mic\.spec\.js/;
const WEBKIT_CAPABILITY_SPEC = /native-speaking-webkit-capability\.spec\.js/;

module.exports = defineConfig({
  testDir: './tests/speaking-regression',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  outputDir: 'test-results/speaking-regression',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/speaking-regression', open: 'never' }],
    ['json', { outputFile: 'test-results/speaking-regression-results.json' }],
  ],
  webServer: {
    // Build once and exercise the production server. This removes Next dev's
    // first-request compilation from the evidence path without masking product
    // failures behind a Playwright retry.
    command: 'npm run build && npm run start',
    // Dedicated port + no reuse: port 3000 is commonly occupied by another
    // local project, and reusing it would let this suite test the wrong app.
    url: 'http://localhost:3210/practice/session',
    // Legacy HTML is fulfilled by the browser harness from checked test snapshots.
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
      name: 'speaking-chromium-desktop',
      testIgnore: WEBKIT_CAPABILITY_SPEC,
      // CI and local runs use the lockfile-matched bundled browser. A branded
      // system Chrome is not an implicit prerequisite for the documented run.
      use: { browserName: 'chromium' },
    },
    {
      name: 'speaking-webkit-desktop',
      // Synthetic WebKit is useful for shared browser behavior and capability
      // recording, but it is not shipping Safari microphone evidence.
      testIgnore: MIC_SPEC,
      use: {
        browserName: 'webkit',
      },
    },
    {
      name: 'speaking-webkit-iphone13',
      // Device emulation changes viewport/input shape, not real iOS microphone
      // behavior. Keep microphone lifecycle on real-device QA.
      testIgnore: MIC_SPEC,
      use: {
        ...devices['iPhone 13'],
        browserName: 'webkit',
      },
    },
  ],
});
