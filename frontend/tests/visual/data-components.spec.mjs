// UIBASE-0056 G03-T08 (FR-005, FR-018): open states the section screenshots
// cannot show: the date calendar (popover at 1280px, bottom sheet at 390px),
// the range calendar, and the learner table scrolled sideways with the name
// and actions columns pinned.
import { test, expect } from '@playwright/test';

async function open(page) {
  const response = await page.goto('/ui-library', { waitUntil: 'networkidle' });
  expect(response?.status(), 'the build must have AVER_ENABLE_UI_LIBRARY=1').toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

test('date calendar open: popover on desktop, sheet with "Xong" on the phone', async ({ page, viewport }) => {
  await open(page);
  const fields = page.getByTestId('date-fields');
  await fields.scrollIntoViewIfNeeded();
  await fields.getByRole('button', { name: 'Mở lịch chọn hạn nộp' }).click();
  const dialog = page.getByRole('dialog', { name: 'Chọn hạn nộp' });
  await expect(dialog.getByRole('heading', { name: 'Tháng 11, 2026' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Xong' })).toBeVisible({ visible: (viewport?.width ?? 0) < 768 });
  await expect(dialog).toHaveScreenshot('date-calendar.png');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('range calendar open: ends dark, days between light, days counted', async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) < 768, 'the phone sheet is covered by the date calendar test');
  await open(page);
  await page.getByRole('button', { name: 'Mở lịch chọn khoảng thời gian báo cáo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Chọn khoảng ngày' });
  await expect(dialog.getByRole('status')).toHaveText('17/11 – 20/11/2026 · 4 ngày');
  await expect(dialog).toHaveScreenshot('date-range-calendar.png');
});

test('learner table scrolled sideways keeps the name and actions columns', async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) >= 768, 'the table fits at 1280px');
  await open(page);
  const demo = page.getByTestId('data-table-learners');
  const frame = demo.locator('table').locator('..');
  await frame.evaluate((el) => { el.scrollLeft = 400; });
  const name = demo.getByRole('rowheader', { name: 'Đặng Thuỳ Dương' });
  const frameBox = await frame.boundingBox();
  const nameBox = await name.boundingBox();
  // Pinned: the name cell sits right after the select column, not scrolled away.
  expect(nameBox.x).toBeGreaterThanOrEqual(frameBox.x);
  expect(nameBox.x).toBeLessThan(frameBox.x + 80);
  const actionBox = await demo.getByRole('link', { name: 'Xem' }).first().boundingBox();
  expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
  // The table scrolls inside its own frame, which stays within the screen
  // (the page itself is not checked: another library section overflows at 390px).
  expect(await frame.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(frameBox.x + frameBox.width).toBeLessThanOrEqual(viewport.width);
  await expect(frame).toHaveScreenshot('data-table-scrolled.png');
});
