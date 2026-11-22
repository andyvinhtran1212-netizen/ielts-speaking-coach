// UIBASE-0056 G03-T04 (FR-014) — screenshot tests of the component library.
// Runs against an already started `next start` whose build had
// AVER_ENABLE_UI_LIBRARY=1 (or AVER_ENABLE_DIAGNOSTIC_ROUTES=1). Base URL from
// UI_LIBRARY_BASE_URL. Run with FONTCONFIG_FILE=<abs>/tests/visual/fonts.conf
// so text rasterises the same on every Linux host. Baselines are Linux-only
// (CI runner ubuntu-24.04); do not commit images generated on macOS. Update
// them only through a PR that says why (FR-014).
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/visual',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  reporter: process.env.CI ? [['list']] : 'list',
  outputDir: './test-results/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: {
    timeout: 10000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: process.env.UI_LIBRARY_BASE_URL || 'http://127.0.0.1:3000',
    headless: true,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    // CI leaves this unset and uses the pinned Playwright Chromium (Chrome for
    // Testing 148.0.7778.96, chromium v1223 at the time of writing). Regenerate
    // baselines with that exact build, e.g. its chrome-headless-shell from
    // storage.googleapis.com/chrome-for-testing-public, passed here.
    launchOptions: process.env.UI_LIBRARY_CHROMIUM ? { executablePath: process.env.UI_LIBRARY_CHROMIUM } : {},
  },
  projects: [
    { name: 'desktop-1280', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'phone-390', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
});
