// PRODUCTION-SMOKE config (ADR-013 — early-stage rollout profile).
//
// The "synthetic volume" half of a low-traffic cutover: a real product at
// early-stage (<100 users, grammar ~1 view/day) can NOT gather a
// statistically-meaningful ORGANIC sample inside a rollout window
// (DEBT-2026-07-22-H: need n≥72; grammar 21 days ≈ 20 samples). So instead of
// freezing main for 21 days to collect noise, this suite drives the cutover
// route on PRODUCTION itself, N times per run, measuring LCP + errors —
// deterministically reaching n≥72 in one ~3-minute run. It carries the
// volume/verdict half; organic traffic + the 48–72h window carry the
// time-drift + client-diversity halves (see ADR-013).
//
// It targets the LIVE production origin (no bypass — these are public routes).
// Route + sample count are parameterised:
//   PRODUCTION_SMOKE_BASE_URL   (default https://averlearning.com)
//   PRODUCTION_SMOKE_ROUTE      (default /)              — the cutover route
//   PRODUCTION_SMOKE_SAMPLES    (default 75)             — n (≥72 → verdict-able)
//   PRODUCTION_SMOKE_LCP_MS     (default 4000)           — absolute LCP p75 ceiling
//
// Run: PRODUCTION_SMOKE_ROUTE=/ npx playwright test -c playwright.production-smoke.config.js
// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/production-smoke',
  // ONE worker: samples are collected sequentially so LCP timings are not
  // skewed by parallel network contention from sibling workers.
  workers: 1,
  // A single run may drive 75+ cold navigations — give it room.
  timeout: 6 * 60_000,
  // retries FORBIDDEN, same rationale as staging-e2e (F4): a synthetic verdict
  // that only passes on retry is a flaky verdict, must fail loudly.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PRODUCTION_SMOKE_BASE_URL || 'https://averlearning.com',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // A representative-ish default viewport; real client diversity is the
    // organic half's job, not this one.
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
