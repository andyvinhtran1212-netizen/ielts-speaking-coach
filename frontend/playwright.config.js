// Sprint 15.2 (F4) — Playwright config for the frontend modal smoke tests.
// Serves the static frontend/ dir via Python's http.server (no Node toolchain,
// no backend, no Supabase) and runs chromium-only smoke tests. Bounded to
// frontend/tests/e2e/ — the rest of the frontend stays zero-dependency.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  // Serve frontend/ as the web root so /css/*, /js/*, /tests/e2e/fixtures/* resolve.
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1',
    url: 'http://127.0.0.1:4173/tests/e2e/fixtures/harness.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
