const { test, expect } = require('@playwright/test');

test('every renderable legacy path emits isolated Gate F evidence in a browser', async ({ page }) => {
  test.setTimeout(120_000);
  const { collectNextMigrationStatus } = await import('../../tooling/next-migration-status.mjs');
  const report = collectNextMigrationStatus();
  expect(report.gateFObservationReady).toBe(true);

  // Once server redirects are installed, browser observation moves to the
  // redirect runtime gate. This static server deliberately cannot reproduce
  // Next's redirect phase, so it must not render frozen HTML and call that
  // post-redirect evidence.
  if (report.legacyRetirementRedirects.installed) {
    expect(report.legacyHtml.serverRedirected).toBe(report.legacyHtml.total);
    expect(report.legacyHtml.directlyRenderable).toBe(0);
    expect(report.legacyHtml.renderablePaths).toEqual([]);
    expect(report.legacyHtml.clientRedirectStubPaths).toEqual([]);
    return;
  }

  const received = new Map();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173\/).*/, (route) => route.abort());
  await page.route('**/js/runtime-config.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.__AVER_RUNTIME_CONFIG__ = Object.freeze({
      apiBase: 'http://127.0.0.1:4173',
      environment: 'browser-test',
      release: 'gate-f-browser-test'
    });`,
  }));
  await page.route('**/api/analytics/events', async (route) => {
    let payload = null;
    try {
      payload = route.request().postDataJSON();
    } catch (_) { /* malformed non-Gate-F telemetry is irrelevant here */ }
    if (payload?.event_name === 'legacy_retirement_page_view') {
      received.set(payload.event_data?.path, payload);
    }
    await route.fulfill({ status: 204, body: '' });
  });

  for (const legacyPath of report.legacyHtml.renderablePaths) {
    await page.goto(legacyPath, { waitUntil: 'commit', timeout: 10_000 });
    await expect.poll(
      () => received.has(legacyPath),
      { message: `${legacyPath} did not emit Gate F evidence`, timeout: 3_000 },
    ).toBe(true);
    const payload = received.get(legacyPath);
    expect(payload.event_data).toMatchObject({
      path: legacyPath,
      implementation: 'legacy',
      telemetry_scope: 'gate-f-legacy-retirement',
      beacon_version: 1,
    });
    expect(Object.keys(payload.event_data).sort()).toEqual([
      'beacon_version',
      'environment',
      'implementation',
      'path',
      'release',
      'telemetry_scope',
    ]);
  }

  const renderableSet = new Set(report.legacyHtml.renderablePaths);
  expect([...received.keys()].filter((path) => renderableSet.has(path)).length)
    .toBe(report.legacyHtml.directlyRenderable);
  // The static test server does not apply Next's server redirects, so a page's
  // own auth fallback can additionally land on a server-redirected artifact.
  // Client redirect stubs must still never be counted as renderable evidence.
  for (const stubPath of report.legacyHtml.clientRedirectStubPaths) {
    expect(received.has(stubPath)).toBe(false);
  }
  expect(report.legacyHtml.clientRedirectStubPaths).toEqual([
    '/admin.html',
    '/pages/admin/cohorts/index.html',
    '/pages/admin/students/index.html',
    '/pricing.html',
  ]);
});
