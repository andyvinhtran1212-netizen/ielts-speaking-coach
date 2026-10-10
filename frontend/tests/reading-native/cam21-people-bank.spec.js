const { test, expect } = require('@playwright/test');
const { cors, installReadingHarness } = require('./reading-native-harness');
const people = require('../fixtures/reading-c21-t1-people.json');

test('C21 T1 source-authored People rubric and repeated C selections in the native admin preview', async ({ page }) => {
  // Keep the local production build's CSP intact and isolate the fixture API.
  await page.route('http://localhost:3211/js/runtime-config.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.__AVER_RUNTIME_CONFIG__=Object.freeze({environment:"test",apiBase:"https://cam21-native.test"});',
  }));
  const bundle = {
    test_id: 'RD-NATIVE-1', title: 'C21 T1 scoped source fixture',
    time_limit_minutes: 60, total_questions: 5,
    passages: [{ passage_order: 2, title: 'People fixture', body_markdown: 'Scoped question-bank fixture.' }],
    questions: people.questions,
  };
  const state = await installReadingHarness(page, {
    apiBase: 'https://cam21-native.test',
    route: '/reading/exam/session?test_id=RD-NATIVE-1&admin_preview=1', bundle,
    handleApi: async ({ route, url }) => {
      if (url.pathname === '/admin/reading/content/tests/RD-NATIVE-1') {
        await route.fulfill({ json: bundle, headers: cors }); return true;
      }
      return false;
    },
  });
  const bank = page.getByRole('complementary', { name: 'List of People', exact: true });
  await expect(bank).toBeVisible();
  await expect(bank.locator('li')).toHaveCount(4);
  await expect(page.getByRole('complementary', { name: 'List of Features', exact: true })).toHaveCount(0);
  await expect(page.locator('.exam-questions__instructions')).toContainText('correct person, A, B, C, or D');
  await expect(page.locator('.exam-questions__instructions')).toContainText('NB You may use any letter more than once.');
  await page.getByRole('radio', { name: 'Question 22: C', exact: true }).check();
  await page.getByRole('radio', { name: 'Question 26: C', exact: true }).check();
  await expect(page.getByRole('radio', { name: 'Question 22: C', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Question 26: C', exact: true })).toBeChecked();
  expect(state.calls.filter(c => c.method !== 'GET' && c.method !== 'OPTIONS' && c.path !== '/api/analytics/events')).toEqual([]);
});
