// Gate B coexistence evidence (plan v3 §16 Gate B + §8.3):
//   1. deployed OWNERSHIP PROBE — the canonical grammar route is still owned
//      by the LEGACY rewrite (until its atomic cutover), and /next-probe is
//      the only Next-owned route;
//   2. NAVIGATION SEAM Next → legacy → Next — full-document navigations that
//      preserve query/hash/theme, with zero console errors and zero
//      production-origin requests across the whole journey.
// @ts-check
const { test, expect } = require('@playwright/test');
const { primeBypassCookie, BYPASS_HEADERS } = require('./helpers');

const PRODUCTION_ORIGINS = [
  'ielts-speaking-coach-production.up.railway.app',
  'huwsmtubwulikhlmcirx.supabase.co',
];

test.beforeEach(async ({ context, baseURL }) => {
  await primeBypassCookie(context, baseURL);
});

test('ownership probe: canonical grammar URL serves the LEGACY article page', async ({ request }) => {
  const res = await request.get('/grammar/tenses/present-simple', { headers: BYPASS_HEADERS });
  expect(res.ok()).toBeTruthy();
  const html = await res.text();
  // Legacy markers: the grammar page script + design tokens. A Next takeover
  // would show the app-router payload instead — this test is the tripwire
  // that the atomic-cutover change (add app route + REMOVE rewrite) must flip
  // intentionally, together (plan §8.2).
  expect(html).toContain('grammar.js');
  expect(html).not.toContain('__next_f');
});

test('ownership probe: /next-probe is Next-rendered (the only Next-owned route)', async ({ request }) => {
  const res = await request.get('/next-probe', { headers: BYPASS_HEADERS });
  expect(res.ok()).toBeTruthy();
  const html = await res.text();
  expect(html).toContain('implementation: next');
  expect(html).toContain('__next_f'); // app-router flight payload marker
});

test('navigation seam: Next → legacy → Next keeps query/hash/theme; zero errors + zero prod egress', async ({ page }) => {
  /** @type {string[]} */ const consoleErrors = [];
  /** @type {string[]} */ const prodRequests = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('request', (req) => {
    if (PRODUCTION_ORIGINS.some((o) => req.url().includes(o))) prodRequests.push(req.url());
  });

  // 1) Start on the Next route; set the theme the legacy page must honor.
  await page.goto('/next-probe');
  await expect(page.locator('h1')).toHaveText('next-probe');
  await page.evaluate(() => localStorage.setItem('av-theme', 'dark'));

  // 2) Full-document navigation to a PUBLIC legacy page WITH query + hash
  //    (§8.3: legacy destinations use location.assign — never client
  //    routing). grammar.html is public — authenticated pages would bounce
  //    an anonymous browser to login and break the seam measurement.
  await page.evaluate(() => {
    window.location.assign('/grammar.html?from=probe&x=1#main');
  });
  await page.waitForURL('**/grammar.html?from=probe&x=1#main');
  await page.waitForLoadState('load');
  // Legacy chrome rendered + anti-flash IIFE honored the theme.
  await expect(page.locator('aver-chrome')).toBeAttached();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // 3) Full-document navigation back to the Next route.
  await page.evaluate(() => {
    window.location.assign('/next-probe');
  });
  await page.waitForURL('**/next-probe');
  await expect(page.locator('h1')).toHaveText('next-probe');
  // Theme storage survived the round trip (shared origin storage).
  expect(await page.evaluate(() => localStorage.getItem('av-theme'))).toBe('dark');

  // 4) Journey-wide invariants.
  expect(prodRequests, `production egress during seam: ${prodRequests.join(', ')}`).toEqual([]);
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|fonts\.gstatic|net::ERR_FAILED/i.test(e), // known cross-origin font noise under bypass-cookie priming
  );
  expect(realErrors, `console errors during seam: ${realErrors.join(' | ')}`).toEqual([]);
});
