// Staging platform invariants (plan Gate A groundwork):
//   1. the deployed runtime config is the STAGING one,
//   2. ZERO requests to production origins while browsing (B25/§7.1 —
//      the browser-level zero-production-egress assertion),
//   3. the landing stats come from the staging API (staging DB), not
//      production.
// @ts-check
const { test, expect } = require('@playwright/test');
const { BYPASS_HEADERS, primeBypassCookie } = require('./helpers');

const PRODUCTION_ORIGINS = [
  'ielts-speaking-coach-production.up.railway.app',
  'huwsmtubwulikhlmcirx.supabase.co',
];

test.beforeEach(async ({ context, baseURL }) => {
  await primeBypassCookie(context, baseURL);
});

test('runtime config served on staging is the staging config', async ({ request }) => {
  const res = await request.get('/js/runtime-config.js', { headers: BYPASS_HEADERS });
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain('"environment": "staging"');
  expect(body).toContain('ielts-speaking-coach-staging.up.railway.app');
  for (const origin of PRODUCTION_ORIGINS) {
    expect(body, `production origin ${origin} leaked into staging config`).not.toContain(origin);
  }
});

test('zero production egress while loading the landing page', async ({ page }) => {
  /** @type {string[]} */
  const offenders = [];
  page.on('request', (req) => {
    if (PRODUCTION_ORIGINS.some((o) => req.url().includes(o))) offenders.push(req.url());
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  expect(offenders, `requests to PRODUCTION origins from staging: ${offenders.join(', ')}`)
    .toEqual([]);
});

test('landing stats are answered by the STAGING API', async ({ page }) => {
  const statsResponse = page.waitForResponse(
    (res) => res.url().includes('/api/public-stats'),
    { timeout: 20_000 },
  );
  await page.goto('/');
  const res = await statsResponse;
  expect(new URL(res.url()).host).toBe('ielts-speaking-coach-staging.up.railway.app');
  expect(res.ok()).toBeTruthy();
});

test('login page renders its chrome', async ({ page }) => {
  await page.goto('/login.html');
  await expect(page.locator('body')).toContainText(/averlearning|Đăng nhập|Google/i);
});
