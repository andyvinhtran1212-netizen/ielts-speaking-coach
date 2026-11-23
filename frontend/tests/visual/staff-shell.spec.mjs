// UIBASE-0056 G03-T16 (FR-010, FR-018): the StaffShell demo of /ui-library at
// 1280px (labels), 1100px and 1024px (icon rail, FR-018) and 390px (drawer),
// plus quick search open and the phone drawer. The whole /ui-library section
// is screenshotted by ui-library.spec.mjs.
import { test, expect } from '@playwright/test';

async function open(page) {
  const response = await page.goto('/ui-library', { waitUntil: 'networkidle' });
  expect(response?.status(), 'the build must have AVER_ENABLE_UI_LIBRARY=1').toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

const isPhone = (viewport) => (viewport?.width ?? 0) < 768;
const admin = (page) => page.getByTestId('staff-shell-admin');

for (const width of [1280, 1100, 1024]) {
  test(`staff admin · ${width}px`, async ({ page, viewport }) => {
    test.skip(isPhone(viewport), 'desktop project resized');
    await page.setViewportSize({ width, height: 800 });
    await open(page);
    const frame = admin(page);
    const label = frame.locator('header').getByText('Production · dữ liệu thật', { exact: true });
    await expect(label).toBeVisible();
    const rail = width < 1200;
    const side = frame.getByRole('navigation', { name: 'Điều hướng quản trị' });
    await expect(side.getByRole('button', { name: /Chấm bài/ })).toBeVisible({ visible: !rail });
    await expect(side.getByRole('link', { name: 'Chấm bài, 7 việc chờ' })).toBeVisible({ visible: rail });
    // FR-018: the shell never scrolls sideways (other library sections are not this test's business).
    expect(await frame.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(frame).toHaveScreenshot(`staff-admin-${width}.png`);
  });
}

test('staff admin · quick search open (⌘K, "minh")', async ({ page, viewport }) => {
  test.skip(isPhone(viewport), 'desktop project only');
  await open(page);
  const box = admin(page).getByRole('combobox', { name: 'Tìm nhanh' });
  await box.click();
  await box.fill('minh');
  await expect(admin(page).getByRole('option')).toHaveCount(5);
  await page.keyboard.press('ArrowDown');
  await expect(admin(page)).toHaveScreenshot('staff-admin-search.png');
  await page.keyboard.press('Escape');
  await expect(admin(page).getByRole('listbox')).toHaveCount(0);
});

test('staff admin · 390px bar, then the drawer', async ({ page, viewport }) => {
  test.skip(!isPhone(viewport), 'phone project only');
  await open(page);
  const frame = admin(page);
  await expect(frame.getByText('Quản trị · Production · dữ liệu thật')).toBeVisible();
  await expect(frame.getByRole('navigation', { name: 'Điều hướng quản trị' })).toBeHidden();
  expect(await frame.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(frame).toHaveScreenshot('staff-admin-390.png');
  await frame.getByRole('button', { name: 'Mở menu quản trị' }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu quản trị' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveScreenshot('staff-admin-390-drawer.png');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});
