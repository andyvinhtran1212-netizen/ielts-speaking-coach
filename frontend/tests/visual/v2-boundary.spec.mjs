// UIBASE-0056 G03-T12 (FR-002, FR-015; acceptance scenarios 1–2): moving
// between the legacy tree and the "Bản in" tree is a full page load, and each
// document carries only its own tree's stylesheets. Uses the diagnostic page
// /profile/v2-pilot (same gate as /ui-library; removed in G03-T14) and the
// public legacy page /flashcard-study, whose <aver-chrome> is the link source
// ChromeNavigationBridge would otherwise soft-navigate. No screenshots.
import { test, expect } from '@playwright/test';

test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'behaviour, not layout: desktop project only');

const LEGACY_CSS = /\/css\/(aver-design|ds|tailwind|flashcard-study)/;

async function tree(page) {
  return page.evaluate(() => ({
    marker: window.__boundaryMarker ?? null,
    sheets: [...document.styleSheets].map((s) => s.href || '').filter(Boolean),
    body: document.body.className,
    av2Paper: getComputedStyle(document.documentElement).getPropertyValue('--av2-paper').trim(),
    chrome: Boolean(document.querySelector('aver-chrome, aver-admin-chrome')),
  }));
}

/** Clicks a link placed inside the legacy chrome's shadow root. */
async function clickChromeLink(page, href) {
  await page.waitForFunction(() => document.querySelector('aver-chrome')?.shadowRoot);
  await page.evaluate((target) => {
    window.__boundaryMarker = 'kept';
    const link = document.createElement('a');
    link.href = target;
    link.id = 'boundary-probe';
    link.textContent = 'probe';
    document.querySelector('aver-chrome').shadowRoot.append(link);
  }, href);
  await page.locator('aver-chrome #boundary-probe').click();
}

test('a v1 → v1 chrome click stays a soft navigation (control)', async ({ page }) => {
  await page.goto('/flashcard-study', { waitUntil: 'networkidle' });
  await clickChromeLink(page, '/flashcard-study?boundary=1');
  await page.waitForURL('**/flashcard-study?boundary=1');
  expect((await tree(page)).marker).toBe('kept');
});

test('v1 → v2 is a full load and leaves no legacy stylesheet (scenario 1)', async ({ page }) => {
  await page.goto('/flashcard-study', { waitUntil: 'networkidle' });
  const before = await tree(page);
  expect(before.sheets.some((href) => LEGACY_CSS.test(href))).toBe(true);
  expect(before.av2Paper).toBe('');

  await clickChromeLink(page, '/profile/v2-pilot');
  await page.waitForURL('**/profile/v2-pilot');
  await expect(page.getByTestId('v2-pilot')).toBeVisible();
  const after = await tree(page);
  expect(after.marker, 'the document was replaced').toBeNull();
  expect(after.sheets.filter((href) => LEGACY_CSS.test(href))).toEqual([]);
  expect(after.body.split(/\s+/)).toContain('av2-body');
  expect(after.body).not.toMatch(/\bav-page\b|\bfcs-page\b/);
  expect(after.av2Paper).not.toBe('');
  expect(after.chrome, 'no legacy chrome on the v2 tree').toBe(false);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.av2-root p')).fontFamily))
    .toMatch(/Source Sans 3/);
});

test('v2 → v1 is a full load and leaves no v2 token (scenario 2)', async ({ page }) => {
  const response = await page.goto('/profile/v2-pilot', { waitUntil: 'networkidle' });
  expect(response?.status(), 'the build must have AVER_ENABLE_UI_LIBRARY=1').toBe(200);
  await page.evaluate(() => { window.__boundaryMarker = 'kept'; });
  await page.getByTestId('to-v1').click();
  await page.waitForURL('**/flashcard-study');
  await page.waitForLoadState('networkidle');
  const after = await tree(page);
  expect(after.marker).toBeNull();
  expect(after.av2Paper).toBe('');
  expect(after.body).not.toMatch(/\bav2-body\b/);
  expect(after.sheets.some((href) => LEGACY_CSS.test(href))).toBe(true);
});
