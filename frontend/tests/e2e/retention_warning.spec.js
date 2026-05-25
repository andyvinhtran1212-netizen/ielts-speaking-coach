// Sprint 16.3.1 (F4) — retention warning chips v2 (audio/content/audio-gone) +
// aggregate banner on the session history list. Semantic selectors so the check
// survives row-template tweaks. Pure consumer of the Sprint 16.2.1 v2 `retention`
// block — no backend/Supabase (static harness).
const { test, expect } = require('@playwright/test');

test('M2: v2 chips render per variant; banner counts only actionable', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/retention-harness.html');

  // Audio purge imminent → amber audio-soon chip.
  const audioSoon = page.locator('tr[data-session-id="s-audio-soon"]');
  await expect(audioSoon.locator('.ds-retention-chip--audio-soon')).toBeVisible();
  await expect(audioSoon).toContainText('Audio sắp xóa');

  // Content purge imminent (audio already gone) → red content-soon chip (priority).
  const contentSoon = page.locator('tr[data-session-id="s-content-soon"]');
  await expect(contentSoon.locator('.ds-retention-chip--content-soon')).toBeVisible();
  await expect(contentSoon).toContainText('Báo cáo sắp xóa');

  // Audio gone, content far → gray audio-gone chip.
  const audioGone = page.locator('tr[data-session-id="s-audio-gone"]');
  await expect(audioGone.locator('.ds-retention-chip--audio-gone')).toBeVisible();
  await expect(audioGone).toContainText('Audio đã xóa');

  // Fresh + legacy (no retention block) → no chip, no crash (Pattern #29).
  await expect(page.locator('tr[data-session-id="s-fresh"] .ds-retention-chip')).toHaveCount(0);
  await expect(page.locator('tr[data-session-id="s-legacy"] .ds-retention-chip')).toHaveCount(0);

  // Banner counts only actionable (audio-soon + content-soon = 2); audio-gone excluded.
  const banner = page.locator('.ds-warning-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('2 phiên');
});
