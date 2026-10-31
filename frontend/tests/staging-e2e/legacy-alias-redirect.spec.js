// Permanent routing regression for retired aliases and canonical Next routes:
//   1. deployed OWNERSHIP PROBE — mỗi route thuộc ĐÚNG một stack. Cập nhật
//      2026-07-31: grammar đã cutover sang Next (pilot 2, 28/07) nên probe
//      kiểm chiều ngược lại và chặn public Legacy artifacts;
//   2. NAVIGATION SEAM Next → legacy alias → canonical Next — full-document
//      redirects that
//      preserve query/hash/theme, with zero console errors and zero
//      production-origin requests across the whole journey.
// @ts-check
const { test, expect } = require('./fixtures');
const {
  primeBypassCookie,
  BYPASS_HEADERS,
  PRODUCTION_ORIGINS,
  isVercelToolbarCspNoise,
} = require('./helpers');

test.beforeEach(async ({ context, baseURL }) => {
  await primeBypassCookie(context, baseURL);
});

// ĐÃ LẬT 2026-07-31 — tripwire này làm đúng việc của nó, nhưng muộn 3 ngày.
// Bài cũ khẳng định `/grammar/:cat/:slug` còn thuộc LEGACY và tự ghi rõ "cutover
// nguyên tử phải lật bài này". Pilot 2 cutover ngày 28/07 (release 524fd210) mà
// không ai lật, VẬY MÀ nightly vẫn xanh mỗi đêm — vì staging bị ghim ở bản
// 14/07, tức trước pilot 2. Cập nhật staging lên bản mới là thứ phơi nó ra.
//
// Bài học ghi lại: một tripwire chỉ có giá trị khi môi trường nó chạy CÙNG BẢN
// với môi trường nó bảo vệ. Staging lệch bản biến "xanh" thành vô nghĩa.
test('ownership probe: canonical grammar URL nay là route NEXT (lật tại pilot 2)', async ({ request }) => {
  const res = await request.get('/grammar/tenses/present-simple', { headers: BYPASS_HEADERS });
  expect(res.ok()).toBeTruthy();
  const html = await res.text();
  expect(html).toContain('__next_f');          // app-router flight payload
  expect(html).not.toContain('/js/grammar.js'); // legacy renderer đã rời route này
});

// Gate F hiện chặn artifact trước public-file serving. Không follow redirect
// ở probe này để chứng minh chính hop 308 tồn tại (response 200 cuối không đủ
// phân biệt redirect với việc vô tình phục vụ lại HTML rollback).
test('ownership probe: retired grammar alias redirects to canonical Next', async ({ request }) => {
  const res = await request.get('/grammar.html', {
    headers: BYPASS_HEADERS,
    maxRedirects: 0,
  });
  expect(res.status()).toBe(308);
  expect(res.headers().location).toBe('/grammar');
});

// U-03: the engineering probe no longer renders on staging. The "a native
// route is Next-rendered" ownership check moved to the always-public `/login`.
test('ownership probe: /login is Next-rendered', async ({ request }) => {
  const res = await request.get('/login', { headers: BYPASS_HEADERS });
  expect(res.ok()).toBeTruthy();
  const html = await res.text();
  expect(html).toContain('lx-shell');
  expect(html).toContain('__next_f'); // app-router flight payload marker
});

test('diagnostic routes are not served on staging (U-03)', async ({ request }) => {
  for (const route of ['/next-probe', '/recorder-spike']) {
    const res = await request.get(route, { headers: BYPASS_HEADERS });
    expect(res.status(), route).toBe(404);
    const html = await res.text();
    expect(html, route).not.toContain('implementation: next');
    expect(html, route).not.toContain('data-testid="btn-start"');
  }
});

test('navigation seam: Next → redirected legacy alias → Next keeps query/hash/theme; zero errors + zero prod egress', async ({ page }) => {
  /** @type {string[]} */ const consoleErrors = [];
  /** @type {string[]} */ const prodRequests = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('request', (req) => {
    if (PRODUCTION_ORIGINS.some((o) => req.url().includes(o))) prodRequests.push(req.url());
  });

  // 1) Start on a public Next route (`/login`; `/next-probe` is a 404 on
  //    staging since U-03); set the theme the canonical destination must honor.
  await page.goto('/login');
  await expect(page.locator('.lx-shell')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('av-theme', 'dark'));

  // 2) Full-document navigation to a retired public alias WITH query + hash.
  //    Gate F must preserve URL identity while redirecting to the App Router.
  await page.evaluate(() => {
    window.location.assign('/grammar.html?from=probe&x=1#main');
  });
  await page.waitForURL('**/grammar?from=probe&x=1#main');
  await page.waitForLoadState('load');
  await expect(page.locator('body')).toContainText('IELTS Grammar Reference');
  // Canonical chrome rendered + the pre-paint theme bootstrap honored storage.
  await expect(page.locator('aver-chrome')).toBeAttached();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // 3) Full-document navigation back to the Next route.
  await page.evaluate(() => {
    window.location.assign('/login');
  });
  await page.waitForURL('**/login');
  await expect(page.locator('.lx-shell')).toBeVisible();
  // Theme storage survived the round trip (shared origin storage).
  expect(await page.evaluate(() => localStorage.getItem('av-theme'))).toBe('dark');

  // 4) Journey-wide invariants.
  expect(prodRequests, `production egress during seam: ${prodRequests.join(', ')}`).toEqual([]);
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|fonts\.gstatic|net::ERR_FAILED/i.test(e)
      && !isVercelToolbarCspNoise(e), // pre-F08 staging builds blocked the injected toolbar; F08 allows vercel.live on non-production builds and installToolbarSkip stubs it
  );
  expect(realErrors, `console errors during seam: ${realErrors.join(' | ')}`).toEqual([]);
});
