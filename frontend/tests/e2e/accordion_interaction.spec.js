// Sprint 15.3 (F4) — Tests M3 + M4: accordion interactions.
// M3: weak-word badge → scroll to + expand + highlight its sub-section.
// M4: clicking a <summary> toggles expand/collapse (native <details>).
const { test, expect } = require('@playwright/test');

test('M3: weak-word badge expands its sub-section, scrolls to it, highlights', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/harness.html');

  const fish = page.locator('details[data-drilldown-word="fish"]');
  await expect(fish).not.toHaveAttribute('open', /.*/);   // collapsed initially

  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.locator('.ds-pron-weak-word[data-pron-idx="0"]').click();

  // Expanded + content visible.
  await expect(fish).toHaveAttribute('open', '');
  await expect(fish.locator('.ds-phoneme').first()).toBeVisible();

  // Scrolled down toward the accordion (it's below a tall spacer).
  await page.waitForTimeout(400);                          // allow smooth scroll
  const scrollAfter = await page.evaluate(() => window.scrollY);
  expect(scrollAfter).toBeGreaterThan(scrollBefore);

  // Highlight class applied (briefly).
  await expect(fish).toHaveClass(/ds-accordion__item--highlight/);
});

test('M4: clicking a sub-section summary toggles it open/closed', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/harness.html');

  const item = page.locator('details[data-drilldown-word="this"]');
  const summary = item.locator('summary.ds-accordion__head');

  await expect(item).not.toHaveAttribute('open', /.*/);
  await summary.click();
  await expect(item).toHaveAttribute('open', '');
  await summary.click();
  await expect(item).not.toHaveAttribute('open', /.*/);
});
