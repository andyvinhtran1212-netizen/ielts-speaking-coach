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
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/staging-e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.STAGING_BASE_URL || 'https://staging.averlearning.com',
    // NOTE: the Vercel bypass header must NOT be a global extraHTTPHeaders —
    // the browser would attach it to every cross-origin request (Railway,
    // fonts), turning them into preflights with an unallowed custom header
    // and CORS-failing them. Specs prime a bypass COOKIE instead (helpers.js).
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
