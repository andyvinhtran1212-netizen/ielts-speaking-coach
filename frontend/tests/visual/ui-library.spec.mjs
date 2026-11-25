// UIBASE-0056 G03-T04 (FR-013, FR-014) — one screenshot per /ui-library
// section at 1280px and 390px (projects in playwright.visual.config.js), in
// light and, from G03-T18, dark (device set to dark, no stored choice).
import { test, expect } from '@playwright/test';
import { UI_LIBRARY_SECTIONS } from '../../lib/ui-library-sections.mjs';

async function open(page) {
  const response = await page.goto('/ui-library', { waitUntil: 'networkidle' });
  expect(response?.status(), 'the build must have AVER_ENABLE_UI_LIBRARY=1').toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

test('the page runs on the v2 tree only (FR-002, FR-004)', async ({ page }) => {
  await open(page);
  const sheets = await page.evaluate(() => [...document.styleSheets].map((s) => s.href || '').filter(Boolean));
  expect(sheets.filter((href) => /\/css\/(aver-design|home|ds|tailwind)/.test(href))).toEqual([]);
  const fonts = await page.evaluate(() => ({
    body: getComputedStyle(document.querySelector('.av2-root p')).fontFamily,
    h1: getComputedStyle(document.querySelector('.av2-root h1')).fontFamily,
  }));
  expect(fonts.body).toMatch(/Source Sans 3/);
  expect(fonts.h1).toMatch(/Source Serif 4/);
});

for (const scheme of ['light', 'dark']) {
  const suffix = scheme === 'dark' ? '-dark' : '';
  for (const { id } of UI_LIBRARY_SECTIONS) {
    test(`section ${id}${suffix}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
      const section = page.locator(`section#${id}`);
      await expect(section).toBeVisible();
      await expect(section).toHaveScreenshot(`${id}${suffix}.png`);
    });
  }
}

// FR-020: the stored choice is on <html> before the first content is attached,
// so a reload never paints light first.
test('no light flash: stored dark on a light device, and no choice on a dark device', async ({ page }) => {
  await page.addInitScript(() => {
    window.__firstPaintTheme = null;
    new MutationObserver((_, observer) => {
      if (document.querySelector('.av2-root')) {
        window.__firstPaintTheme = document.documentElement.getAttribute('data-theme');
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.addInitScript(() => localStorage.setItem('av-theme', 'dark'));
  await open(page);
  expect(await page.evaluate(() => window.__firstPaintTheme)).toBe('dark');
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.av2-root')).backgroundColor);
  expect(bg).toBe('rgb(28, 26, 22)');

  const fresh = await page.context().browser().newPage({ colorScheme: 'dark' });
  await fresh.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (document.querySelector('.av2-root')) {
        window.__firstPaintTheme = document.documentElement.getAttribute('data-theme');
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await open(fresh);
  expect(await fresh.evaluate(() => window.__firstPaintTheme)).toBe('dark');
  await fresh.close();
});

// FR-021, FR-026: the menu applies at once, other tabs follow, metas re-point.
test('ThemeMenu: choose Tối, the other tab follows; Theo thiết bị clears the key', async ({ page, context }) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  expect(await page.locator('meta[name="theme-color"]').evaluateAll((m) => m.map((x) => [x.media, x.content])))
    .toEqual([['(prefers-color-scheme: light)', '#FAF6EF'], ['(prefers-color-scheme: dark)', '#1C1A16']]);

  const button = page.locator('header').getByRole('button', { name: 'Giao diện: Theo thiết bị. Đổi giao diện' });
  await button.click();
  await page.locator('header').getByRole('menuitemradio', { name: 'Tối' }).click();
  expect(await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('av-theme')])).toEqual(['dark', 'dark']);
  expect(await page.locator('meta[name="theme-color"]').evaluateAll((m) => m.map((x) => x.content))).toEqual(['#1C1A16', '#1C1A16']);
  await expect.poll(() => other.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await expect(other.locator('header').getByRole('button', { name: 'Giao diện: Tối. Đổi giao diện' })).toBeVisible();

  await page.locator('header').getByRole('button', { name: 'Giao diện: Tối. Đổi giao diện' }).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('av-theme')])).toEqual(['light', null]);
  await expect.poll(() => other.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await other.close();
});

// FR-024: printing is light even when the web is dark.
test('print media stays light while dark is chosen', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('av-theme', 'dark'));
  await open(page);
  await page.emulateMedia({ media: 'print' });
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.av2-root')).backgroundColor);
  expect(bg).toBe('rgb(250, 246, 239)');
});
