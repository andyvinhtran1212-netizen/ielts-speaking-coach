// UIBASE-0056 G03-T04 (FR-013, FR-014) — one screenshot per /ui-library
// section at 1280px and 390px (projects in playwright.visual.config.js).
import { test, expect } from '@playwright/test';
import { UI_LIBRARY_SECTIONS } from '../../lib/ui-library-sections.mjs';

test.beforeEach(async ({ page }) => {
  const response = await page.goto('/ui-library', { waitUntil: 'networkidle' });
  expect(response?.status(), 'the build must have AVER_ENABLE_UI_LIBRARY=1').toBe(200);
  await page.evaluate(() => document.fonts.ready);
});

test('the page runs on the v2 tree only (FR-002, FR-004)', async ({ page }) => {
  const sheets = await page.evaluate(() => [...document.styleSheets].map((s) => s.href || '').filter(Boolean));
  expect(sheets.filter((href) => /\/css\/(aver-design|home|ds|tailwind)/.test(href))).toEqual([]);
  const fonts = await page.evaluate(() => ({
    body: getComputedStyle(document.querySelector('.av2-root p')).fontFamily,
    h1: getComputedStyle(document.querySelector('.av2-root h1')).fontFamily,
  }));
  expect(fonts.body).toMatch(/Source Sans 3/);
  expect(fonts.h1).toMatch(/Source Serif 4/);
});

for (const { id } of UI_LIBRARY_SECTIONS) {
  test(`section ${id}`, async ({ page }) => {
    const section = page.locator(`section#${id}`);
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot(`${id}.png`);
  });
}
