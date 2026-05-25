// Sprint 15.3.1 (F4) — Test M5: result.html phoneme accordion parity. Verifies
// the result.html data path (raw payload → extractor → shared accordion) in a
// real browser. Same semantic selectors as the practice accordion (M1/M3).
const { test, expect } = require('@playwright/test');

test('M5: post-15.1 payload → accordion renders on the result surface', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/result-harness.html');

  const accordion = page.locator('#mount-normal [data-drilldown-content]');
  await expect(accordion).toBeVisible();
  await expect(page.locator('#mount-normal details[data-drilldown-word="fish"]')).toHaveCount(1);
  // 1 weak word → smart default expanded → phoneme rows visible.
  await expect(page.locator('#mount-normal .ds-phoneme').first()).toBeVisible();
  await expect(accordion).toContainText('fish');
});

test('M5b: legacy (pre-15.1, Word-granularity) payload → graceful placeholder', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/result-harness.html');

  const legacy = page.locator('#mount-legacy [data-drilldown-legacy]');
  await expect(legacy).toBeVisible();
  await expect(legacy).toContainText('chưa khả dụng');
  // No accordion rendered for legacy sessions.
  await expect(page.locator('#mount-legacy [data-drilldown-content]')).toHaveCount(0);
});
