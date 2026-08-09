// Gate E Speaking browser fixtures — native App Router player only.
//
// This suite deliberately has its own config/testDir. The legacy fixture
// smoke tests use a static server; Gate E must exercise the hydrated Next
// route, React-owned state store and authenticated bootstrap together.
//
// Run: npm run test:e2e:gate-e
// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/gate-e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'npm run dev',
    // Dedicated port + no reuse: port 3000 is commonly occupied by another
    // local project, and reusing it would let this suite test the wrong app.
    url: 'http://localhost:3210/practice/session',
    env: { PORT: '3210' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:3210',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // CI installs the lockfile-matched Playwright Chromium. Local macOS may
      // already have stable Chrome while the exact cache revision is absent;
      // use that signed system browser instead of making a network download a
      // prerequisite for this deterministic suite.
      use: {
        browserName: 'chromium',
        ...(process.env.CI ? {} : { channel: 'chrome' }),
      },
    },
  ],
});
