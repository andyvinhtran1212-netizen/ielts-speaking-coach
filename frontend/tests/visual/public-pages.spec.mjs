// UIBASE-0056 G03-T13 (FR-002, FR-011; acceptance scenario 1): the four legal
// pages on PublicShell, one full-page screenshot each at 1280px and 390px
// (projects in playwright.visual.config.js), plus the phone menu open. These
// pages are public and static, so no build flag is needed.
import { test, expect } from '@playwright/test';

const PAGES = ['terms', 'privacy', 'contact', 'about'];
const LEGACY_CSS = /\/css\/(aver-design|ds|tailwind|index|legal)/;

async function open(page, path) {
  const response = await page.goto(path, { waitUntil: 'networkidle' });
  expect(response?.status()).toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

test('/terms runs on the v2 tree only, and <body> computes to Source Sans 3 (scenario 1)', async ({ page }) => {
  await open(page, '/terms');
  const state = await page.evaluate(() => ({
    sheets: [...document.styleSheets].map((s) => s.href || '').filter(Boolean),
    body: getComputedStyle(document.body).fontFamily,
    h1: getComputedStyle(document.querySelector('h1')).fontFamily,
    chrome: Boolean(document.querySelector('aver-chrome, aver-admin-chrome')),
    lucide: Boolean(document.querySelector('script[src*="lucide"]')),
  }));
  expect(state.sheets.filter((href) => LEGACY_CSS.test(href))).toEqual([]);
  expect(state.body).toMatch(/^"?Source Sans 3/);
  expect(state.h1).toMatch(/Source Serif 4/);
  expect(state.chrome).toBe(false);
  expect(state.lucide).toBe(false);
});

for (const name of PAGES) {
  test(`/${name} page`, async ({ page }) => {
    await open(page, `/${name}`);
    await expect(page).toHaveScreenshot(`public-${name}.png`, { fullPage: true });
  });
}

test('phone menu open', async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 768, 'the menu exists below 768px only');
  await open(page, '/terms');
  await page.getByRole('button', { name: 'Mở menu' }).click();
  await expect(page.getByRole('banner')).toHaveScreenshot('public-menu-open.png');
});
