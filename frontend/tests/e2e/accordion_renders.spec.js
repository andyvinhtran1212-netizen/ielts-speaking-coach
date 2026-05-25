// Sprint 15.3 (F4) — Test M1 (revised): the phoneme drill-down ACCORDION renders
// inline in the pronunciation section. Replaces the 15.1.2 modal M1. Semantic
// selectors ([data-drilldown-content], <details data-drilldown-word>) so the
// check survived the modal→accordion migration and survives future tweaks.
const { test, expect } = require('@playwright/test');

test('M1: accordion renders inline with a sub-section per weak word', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/harness.html');

  const accordion = page.locator('[data-drilldown-content]');
  await expect(accordion).toBeVisible();

  // One <details> per weak word (the harness seeds 2).
  const items = page.locator('details.ds-accordion__item');
  await expect(items).toHaveCount(2);
  await expect(page.locator('details[data-drilldown-word="fish"]')).toHaveCount(1);

  // Smart default: 2 weak words → collapsed (no [open]).
  await expect(page.locator('details.ds-accordion__item[open]')).toHaveCount(0);

  // Summaries show the word + a "âm cần luyện" count.
  await expect(accordion).toContainText('fish');
  await expect(accordion).toContainText('âm cần luyện');
});
