// Gate B coexistence evidence (plan v3 §16 Gate B + §8.3):
//   1. deployed OWNERSHIP PROBE — mỗi route thuộc ĐÚNG một stack. Cập nhật
//      2026-07-31: grammar đã cutover sang Next (pilot 2, 28/07) nên probe
//      kiểm chiều ngược lại + một trang chưa cutover vẫn phải là legacy;
//   2. NAVIGATION SEAM Next → legacy → Next — full-document navigations that
//      preserve query/hash/theme, with zero console errors and zero
//      production-origin requests across the whole journey.
// @ts-check
const { test, expect } = require('@playwright/test');
const { primeBypassCookie, BYPASS_HEADERS, PRODUCTION_ORIGINS } = require('./helpers');

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

// Coexistence vẫn phải đúng cho phần CHƯA cutover — nếu không thì "Next chiếm
// hết" cũng làm bài trên xanh mà chẳng chứng minh gì.
test('ownership probe: trang chưa cutover vẫn do LEGACY phục vụ', async ({ request }) => {
  const res = await request.get('/grammar.html', { headers: BYPASS_HEADERS });
  expect(res.ok()).toBeTruthy();
  const html = await res.text();
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
