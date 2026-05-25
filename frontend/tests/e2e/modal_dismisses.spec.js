// Sprint 15.2 (F4) — Test M2: ESC dismisses the drill-down modal. Native
// <dialog> (Sprint 15.1.2) handles ESC + the 'close' handler removes it from
// the DOM. Guards keyboard-dismiss regressions (e.g. a Sprint 15.3 accordion
// refactor that drops ESC handling).
const { test, expect } = require('@playwright/test');

test('M2: ESC closes the modal and removes it from the DOM', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/harness.html');

  await page.locator('.ds-pron-weak-word').click();
  const dialog = page.locator('dialog.ds-modal');
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');

  // The 'close' handler removes the dialog node on dismiss.
  await expect(page.locator('dialog.ds-modal')).toHaveCount(0);
});

test('M2b: the close button also dismisses the modal', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/harness.html');

  await page.locator('.ds-pron-weak-word').click();
  await expect(page.locator('dialog.ds-modal')).toBeVisible();

  await page.locator('dialog.ds-modal [data-pron-close]').click();
  await expect(page.locator('dialog.ds-modal')).toHaveCount(0);
});
