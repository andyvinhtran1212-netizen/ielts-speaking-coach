// UIBASE-0056 G03-T15 (FR-009, FR-025): FocusShell on /ui-library, its leave
// boxes, and the full-test room staying light while the site is dark. The
// section itself is screenshotted by ui-library.spec.mjs.
import { test, expect } from '@playwright/test';

async function open(page) {
  const response = await page.goto('/ui-library', { waitUntil: 'networkidle' });
  expect(response?.status(), 'the build must have AVER_ENABLE_UI_LIBRARY=1').toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

const isPhone = (viewport) => (viewport?.width ?? 0) < 768;

test('practice · leave box opens on "Thoát", stay is focused, Esc closes', async ({ page, viewport }) => {
  await open(page);
  const demo = page.getByTestId('focus-practice-demo');
  await demo.scrollIntoViewIfNeeded();
  await demo.getByRole('button', { name: 'Thoát' }).click();
  const box = page.getByRole('alertdialog', { name: 'Thoát khi đang ghi âm?' });
  await expect(box).toBeVisible();
  await expect(box.getByRole('button', { name: 'Ở lại ghi tiếp' })).toBeFocused();
  // The box only: the page behind the backdrop changes whenever a section is added above.
  await expect(box).toHaveScreenshot(`focus-practice-leave${isPhone(viewport) ? '' : '-1280'}.png`);
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
});

test('exam · leave box in English, no "Save and exit"', async ({ page, viewport }) => {
  test.skip(isPhone(viewport), 'full tests are not taken on a phone');
  await open(page);
  const demo = page.getByTestId('focus-exam-demo');
  await demo.scrollIntoViewIfNeeded();
  await demo.getByRole('button', { name: 'Leave test' }).click();
  const box = page.getByRole('alertdialog', { name: 'Leave this test?' });
  await expect(box).toContainText('The timer keeps running on our server while you are away.');
  await expect(page.getByText(/save and exit/i)).toHaveCount(0);
  await expect(box).toHaveScreenshot('focus-exam-leave.png');
});

test('FR-025: with the site dark, the full-test bar stays light and practice follows the site', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  const bg = (testId) => page.getByTestId(testId).locator('header').evaluate((el) => getComputedStyle(el).backgroundColor);
  // Exam bar = light --av2-ink (#1B1A17); practice bar = dark --av2-surface (#24211C).
  expect(await bg('focus-exam-demo')).toBe('rgb(27, 26, 23)');
  expect(await bg('focus-practice-demo')).toBe('rgb(36, 33, 28)');
});
