// Gate E automated device-matrix foundation. This bounded browser journey is
// intentionally repeated on Chromium desktop, WebKit desktop and WebKit with
// an iPhone viewport. WebKit emulation is NOT real Safari/iOS evidence; the
// versioned real-device requirements stay pending in the matrix manifest.
// @ts-check
const { test, expect } = require('@playwright/test');
const { primeBypassCookie } = require('./helpers');

const MATRIX_PROJECTS = new Set([
  'matrix-chromium-148-desktop',
  'matrix-webkit-26.4-desktop',
  'matrix-webkit-26.4-iphone13',
]);
const PRODUCTION_ORIGINS = [
  'ielts-speaking-coach-production.up.railway.app',
  'huwsmtubwulikhlmcirx.supabase.co',
];

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  expect(MATRIX_PROJECTS.has(testInfo.project.name)).toBe(true);
  await primeBypassCookie(context, baseURL);
});

test('Next → legacy → Next seam keeps origin storage and never calls production', async ({ page }) => {
  /** @type {string[]} */ const productionRequests = [];
  page.on('request', (request) => {
    if (PRODUCTION_ORIGINS.some((origin) => request.url().includes(origin))) {
      productionRequests.push(request.url());
    }
  });

  await page.goto('/next-probe');
  await expect(page.locator('h1')).toHaveText('next-probe');
  await page.evaluate(() => localStorage.setItem('av-theme', 'dark'));

  await page.evaluate(() => {
    window.location.assign('/grammar.html?from=gate-e-matrix#main');
  });
  await page.waitForURL('**/grammar.html?from=gate-e-matrix#main');
  await expect(page.locator('aver-chrome')).toBeAttached();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.evaluate(() => window.location.assign('/next-probe'));
  await page.waitForURL('**/next-probe');
  expect(await page.evaluate(() => localStorage.getItem('av-theme'))).toBe('dark');
  expect(productionRequests).toEqual([]);
});

test('signed-out private route fails closed and login has no horizontal overflow', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForURL('**/login.html*', { timeout: 20_000 });
  await expect(page.locator('body')).toContainText(/averlearning|Đăng nhập|Google/i);

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(layout.content).toBeLessThanOrEqual(layout.viewport + 1);
});
