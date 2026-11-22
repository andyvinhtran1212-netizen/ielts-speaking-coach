// UIBASE-0056 G03-T14 (FR-007, FR-008, FR-017; acceptance scenarios 3–4):
// LearnerShell at 1280px, 900px and 390px on the diagnostic page
// /profile/v2-pilot (same build flag as /ui-library), plus its overlays.
// The /ui-library section itself is screenshotted by ui-library.spec.mjs.
import { test, expect } from '@playwright/test';

async function open(page, path) {
  const response = await page.goto(path, { waitUntil: 'networkidle' });
  expect(response?.status(), 'the build must have AVER_ENABLE_UI_LIBRARY=1').toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

const isPhone = (viewport) => (viewport?.width ?? 0) < 768;

test('scenario 3: /ui-library at 390px shows the 5-cell bottom bar with "Luyện tập" current', async ({ page, viewport }) => {
  test.skip(!isPhone(viewport), 'phone project only');
  await open(page, '/ui-library');
  const bar = page.getByTestId('learner-shell-demo').getByRole('navigation', { name: 'Thanh mục chính' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('link')).toHaveCount(5);
  const current = bar.getByRole('link', { name: 'Luyện tập' });
  await expect(current).toHaveAttribute('aria-current', 'page');
  const style = await current.evaluate((el) => {
    const s = getComputedStyle(el);
    return { rule: s.borderTopWidth, weight: s.fontWeight };
  });
  expect(style).toEqual({ rule: '3px', weight: '600' });
});

test('learner pilot · bar', async ({ page, viewport }) => {
  await open(page, '/profile/v2-pilot');
  await expect(page).toHaveScreenshot(`learner-pilot${isPhone(viewport) ? '' : '-1280'}.png`);
});

test('learner pilot · tablet 900px with the menu open', async ({ page, viewport }) => {
  test.skip(isPhone(viewport), 'desktop project resized to 900px');
  await page.setViewportSize({ width: 900, height: 800 });
  await open(page, '/profile/v2-pilot');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Mục chính', exact: true })).toBeHidden();
  await expect(page).toHaveScreenshot('learner-pilot-900.png');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Menu mục chính' })).toBeVisible();
  await expect(page).toHaveScreenshot('learner-pilot-900-menu.png');
});

test('learner pilot · account menu (scenario 4: a learner has no "Đổi vai trò")', async ({ page }) => {
  await open(page, '/profile/v2-pilot');
  await page.getByRole('button', { name: /^Tài khoản:/ }).click();
  const menu = page.getByRole('dialog', { name: 'Tài khoản' });
  await expect(menu).toBeVisible();
  await expect(menu.getByText(/Đổi vai trò/)).toHaveCount(0);
  await expect(page).toHaveScreenshot('learner-pilot-account.png');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Tài khoản:/ })).toBeFocused();
});

test('learner pilot · quick lookup', async ({ page, viewport }) => {
  test.skip(isPhone(viewport), 'no magnifier on the phone bar');
  await open(page, '/profile/v2-pilot');
  await page.locator('body').press('/');
  const box = page.getByRole('combobox', { name: 'Tra nhanh' });
  await expect(box).toBeFocused();
  await box.fill('agree');
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page).toHaveScreenshot('learner-pilot-lookup.png');
});

test('learner pilot · phone has no magnifier and no section row', async ({ page, viewport }) => {
  test.skip(!isPhone(viewport), 'phone project only');
  await open(page, '/profile/v2-pilot');
  await expect(page.getByRole('button', { name: /Tra nhanh/ })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Mục chính', exact: true })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Thanh mục chính' })).toBeVisible();
});
