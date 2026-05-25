// Sprint 16.3 (F4) — deletion-warning chip + aggregate banner on the session
// history list. Semantic selectors (.ds-retention-chip, .ds-warning-banner,
// [data-session-id]) so the check survives row-template tweaks. Pure consumer of
// the Sprint 16.2 `retention` block — no backend/Supabase (static harness).
const { test, expect } = require('@playwright/test');

test('M2: soft-hide chip shows for soon sessions only; banner aggregates', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/retention-harness.html');

  // A session 2 days from hide → amber chip with VN copy.
  const soonRow = page.locator('tr[data-session-id="s-soon"]');
  await expect(soonRow.locator('.ds-retention-chip')).toBeVisible();
  await expect(soonRow).toContainText('Sắp ẩn');

  // A session 10 days out → no chip.
  await expect(page.locator('tr[data-session-id="s-fresh"] .ds-retention-chip')).toHaveCount(0);

  // A legacy row with no retention block → no chip, no crash (Pattern #29).
  await expect(page.locator('tr[data-session-id="s-legacy"] .ds-retention-chip')).toHaveCount(0);

  // Aggregate banner reflects the single soon-to-hide session.
  const banner = page.locator('.ds-warning-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('1 phiên sắp bị ẩn');
});
