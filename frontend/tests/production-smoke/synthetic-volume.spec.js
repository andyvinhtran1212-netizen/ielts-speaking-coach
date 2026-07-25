// @ts-check
// Synthetic-volume smoke (ADR-013). One run = n samples over the cutover route
// on PRODUCTION → an LCP p75 + error-rate verdict without waiting for organic
// traffic. This is the "volume half" of an early-stage rollout; it does NOT
// replace the 48–72h organic observation (time-drift + real client diversity).
//
// Each sample is a COLD load in a fresh browser context (no shared cache) so
// LCP reflects a first-time visitor — the worst case, and the one a small
// organic sample is least likely to surface. We record:
//   - LCP (largest-contentful-paint, buffered)
//   - HTTP status of the document response
//   - any page error (uncaught JS) or console "error"
// then compute p75 LCP and assert against the frozen absolute ceiling.

const { test, expect } = require('@playwright/test');

const ROUTE   = process.env.PRODUCTION_SMOKE_ROUTE   || '/';
const SAMPLES = parseInt(process.env.PRODUCTION_SMOKE_SAMPLES || '75', 10);
const LCP_MS  = parseInt(process.env.PRODUCTION_SMOKE_LCP_MS  || '4000', 10);
// Verdict needs a floor of samples to mean anything (DEBT-2026-07-22-H).
const MIN_N   = 72;

/** nearest-rank p75 */
function p75(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(0.75 * s.length) - 1);
  return Math.round(s[idx]);
}

test(`synthetic volume: ${ROUTE} — n=${SAMPLES} cold loads, LCP p75 < ${LCP_MS}ms, 0 errors`, async ({ browser }) => {
  const lcps = [];
  const failures = []; // { i, reason }

  for (let i = 0; i < SAMPLES; i++) {
    // Fresh context = cold cache each iteration (first-time-visitor LCP).
    const context = await browser.newContext();
    const page = await context.newPage();
    let pageErr = null;
    let consoleErr = null;
    page.on('pageerror', (e) => { pageErr = pageErr || String(e.message || e); });
    page.on('console', (m) => { if (m.type() === 'error') consoleErr = consoleErr || m.text().slice(0, 200); });

    try {
      const resp = await page.goto(ROUTE, { waitUntil: 'load', timeout: 20_000 });
      const status = resp ? resp.status() : 0;
      if (status < 200 || status >= 400) failures.push({ i, reason: `HTTP ${status}` });

      // Let LCP settle, then read the last buffered entry.
      const lcp = await page.evaluate(() => new Promise((resolve) => {
        let v = null;
        try {
          new PerformanceObserver((list) => {
            const es = list.getEntries();
            const last = es[es.length - 1];
            if (last) v = Math.round(last.renderTime || last.loadTime || last.startTime);
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch { /* browser without LCP support */ }
        setTimeout(() => resolve(v), 1500);
      }));
      if (typeof lcp === 'number') lcps.push(lcp);

      if (pageErr) failures.push({ i, reason: `pageerror: ${pageErr}` });
      if (consoleErr) failures.push({ i, reason: `console.error: ${consoleErr}` });
    } catch (e) {
      failures.push({ i, reason: `nav: ${String(e.message || e).slice(0, 120)}` });
    } finally {
      await context.close();
    }
  }

  const verdict = {
    route: ROUTE,
    samples_requested: SAMPLES,
    lcp_samples: lcps.length,
    lcp_p75_ms: p75(lcps),
    lcp_ceiling_ms: LCP_MS,
    errors: failures.length,
    failures: failures.slice(0, 10),
  };
  // Machine-readable line for the workflow summary + human log.
  console.log('SYNTHETIC_VERDICT ' + JSON.stringify(verdict));

  // Verdict gates:
  expect(lcps.length, `too few LCP samples (${lcps.length} < ${MIN_N}) → verdict not meaningful`).toBeGreaterThanOrEqual(MIN_N);
  expect(failures, `synthetic errors on ${ROUTE}`).toEqual([]);
  expect(verdict.lcp_p75_ms, `LCP p75 ${verdict.lcp_p75_ms}ms ≥ ceiling ${LCP_MS}ms`).toBeLessThan(LCP_MS);
});
