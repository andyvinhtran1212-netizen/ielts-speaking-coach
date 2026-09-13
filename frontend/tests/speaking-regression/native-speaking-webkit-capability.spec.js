// The pinned Playwright WebKit build on Linux CI does not expose MediaRecorder.
// Keep that runner-specific boundary executable without claiming every WebKit
// environment has the same gap. Shipping Safari/iOS remains a manual real-device
// requirement regardless of this synthetic engine result.
const { test, expect } = require('@playwright/test');

test('pinned synthetic WebKit records its MediaRecorder capability', async ({ page }, testInfo) => {
  await page.goto('/next-probe');
  await expect(page.locator('h1')).toHaveText('next-probe');
  const capability = await page.evaluate(() => typeof window.MediaRecorder);
  testInfo.annotations.push({ type: 'mediarecorder', description: capability });

  if (process.platform === 'linux' && process.env.CI) {
    expect(capability).toBe('undefined');
  } else {
    expect(['function', 'undefined']).toContain(capability);
  }
});
