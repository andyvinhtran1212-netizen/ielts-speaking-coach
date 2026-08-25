// STAGING E2E config (plan §11.3 — "staging-e2e", named to never be confused
// with the fixture-harness smoke in playwright.config.js / plan B8).
//
// Targets the real staging deployment (staging.averlearning.com → staging
// Railway → staging Supabase). Vercel Preview protection is crossed with the
// "Protection Bypass for Automation" secret:
//   STAGING_BYPASS   (required) — Vercel bypass token
//   E2E_PASSWORD     (optional) — synthetic identity password; must match the
//                     one used by backend/scripts/staging_seed.py
//
// Run:  STAGING_BYPASS=... npx playwright test -c playwright.staging.config.js
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// Gate E matrix foundation. The full mutation-heavy staging suite still runs
// exactly once because it drives shared identities and environment-global
// kill switches. A bounded browser seam spec runs on each synthetic engine /
// viewport. WebKit is useful compatibility evidence, but is NOT represented as
// real Safari/iOS evidence (see docs/GATE_E_DEVICE_MATRIX_2026-08-09.md).
const MATRIX_SPEC = '**/device-matrix.spec.js';

module.exports = defineConfig({
  testDir: './tests/staging-e2e',
  // ONE worker, always: this suite drives a SHARED live environment with
  // SHARED identities, so cross-file parallelism is racy by construction —
  // proven live 2026-07-13: pilot-3's isolation test calls signOut() on the
  // student (supabase-js default scope = GLOBAL → revokes every session of
  // that identity server-side) and deterministically 401'd pilot-4's student
  // session between its PATCH and its canonical-reconcile GET in the parallel
  // worker. Kill-switch flips (pilot-4 drill) are similarly environment-global.
  workers: 1,
  timeout: 45_000,
  // AUDIT F4: retries are FORBIDDEN — the Gate A streak contract (master
  // plan §Gate A) says any retry resets the streak, so a run that only
  // passes on retry must fail loudly, not count as green. retries: 0 makes
  // pass-on-retry impossible by construction (nothing to audit after the
  // fact — flaky = red).
  retries: 0,
  reporter: process.env.CI
    ? [
        ['github'],
        ['json', { outputFile: 'test-results/staging-e2e-results.json' }],
        ['html', { open: 'never' }],
      ]
    : 'list',
  use: {
    baseURL: process.env.STAGING_BASE_URL || 'https://staging.averlearning.com',
    // NOTE: the Vercel bypass header must NOT be a global extraHTTPHeaders —
    // the browser would attach it to every cross-origin request (Railway,
    // fonts), turning them into preflights with an unallowed custom header
    // and CORS-failing them. Specs prime a bypass COOKIE instead (helpers.js).
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'staging-core-chromium',
      testIgnore: MATRIX_SPEC,
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
    {
      name: 'matrix-chromium-148-desktop',
      testMatch: MATRIX_SPEC,
      use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
    },
    {
      name: 'matrix-webkit-26.4-desktop',
      testMatch: MATRIX_SPEC,
      use: { ...devices['Desktop Safari'], browserName: 'webkit' },
    },
    {
      name: 'matrix-webkit-26.4-iphone13',
      testMatch: MATRIX_SPEC,
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
  ],
});
