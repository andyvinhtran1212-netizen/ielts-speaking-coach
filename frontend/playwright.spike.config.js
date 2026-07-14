// Risk-spike browser matrix (plan Phase 2 critical-risk spikes) — LOCAL next
// server, real browser engines. Separate config so spike runs never mix with
// the fixture smoke (playwright.config.js) or staging-e2e.
//
// Chromium gets fake media devices (a generated tone on the fake mic) so
// MediaRecorder produces real audio bytes deterministically. WebKit is the
// Safari engine probe: it has no fake-device CLI switches — the spec
// documents what works/what needs a manual Safari run.
//
// Run:  npx playwright test -c playwright.spike.config.js
//       (starts `npm run dev` itself via webServer)
// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/spike',
  timeout: 90_000,
  workers: 1, // one dev server, deterministic mic ownership
  reporter: 'list',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/recorder-spike',
    // Port 3000 REQUIRED: it is the only localhost origin in the backend CORS
    // allowlist — the staging-upload test does a real cross-origin multipart
    // POST from this page's origin.
    env: { PORT: '3000' },
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        permissions: ['microphone'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ],
        },
      },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
  ],
});
