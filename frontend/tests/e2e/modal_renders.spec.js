// Sprint 15.2 (F4) — Test M1: the phoneme drill-down modal opens centered +
// visible in a real browser. Guards the Sprint 15.1.2 regression class (the
// modal rendered ~280px bottom-left with no backdrop — source-scan CI missed it).
const { test, expect } = require('@playwright/test');

test('M1: weak-word badge opens a visible, viewport-centered modal', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/harness.html');

  // Public path: click the weak-word badge (not an internal API).
  await page.locator('.ds-pron-weak-word').click();

  const dialog = page.locator('dialog.ds-modal');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveJSProperty('open', true);

  // Content rendered for the clicked word (semantic — survives a modal→accordion
  // migration as long as the drilldown shows the word + its phonemes).
  await expect(dialog).toContainText('fish');
  await expect(dialog).toContainText('Ví dụ');   // example-words line from the lookup

  // Centered in the viewport (this is what bottom-left rendering violated).
  const box = await dialog.boundingBox();
  const vp = page.viewportSize();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  expect(Math.abs(cx - vp.width / 2)).toBeLessThan(100);
  expect(Math.abs(cy - vp.height / 2)).toBeLessThan(150);
});
