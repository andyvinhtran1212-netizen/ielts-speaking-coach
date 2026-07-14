// Spike-2 fix (defect g) regression: test_part answers upload EAGERLY, so a
// refresh mid-test resumes at the first UNANSWERED question (persisted
// responses drive the position) instead of redoing — and losing — everything.
// Real /pages/practice.html + stubbed backend (nothing leaves the browser).
const { test, expect } = require('@playwright/test');

const SB_KEY = 'sb-huwsmtubwulikhlmcirx-auth-token';
const SID = '33333333-3333-4333-8333-333333333301';
const Q = ['q-aaa', 'q-bbb', 'q-ccc'];

const FAKE_SESSION = {
  access_token: 'fake-token', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
  user: { id: '00000000-0000-4000-8000-0000000000aa', email: 'pt@test.local', aud: 'authenticated', user_metadata: {} },
};

async function openTestPart(page, answeredIds, tracker) {
  await page.route('http://localhost:8000/**', (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'authorization, content-type, x-request-id',
      } });
    }
    if (tracker) tracker.push(req.method() + ' ' + url.replace('http://localhost:8000', ''));
    const cors = { 'access-control-allow-origin': '*' };
    if (url.endsWith(`/sessions/${SID}`)) {
      return route.fulfill({ json: {
        session_id: SID, id: SID, mode: 'test_part', part: 1, topic: 'Hobbies',
        status: 'in_progress',
        responses: answeredIds.map((qid) => ({ id: 'r-' + qid, question_id: qid, overall_band: 6.0 })),
      }, headers: cors });
    }
    if (url.endsWith(`/sessions/${SID}/questions`)) {
      return route.fulfill({ json: Q.map((qid, i) => ({ id: qid, question_text: 'Question ' + (i + 1) + '?', part: 1, order_num: i + 1 })), headers: cors });
    }
    if (url.includes('/complete')) {
      return route.fulfill({ json: { session_id: SID, status: 'completed' }, headers: cors });
    }
    return route.fulfill({ status: 404, json: {}, headers: cors });
  });

  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v),
    [SB_KEY, JSON.stringify(FAKE_SESSION)]);
  await page.goto(`/pages/practice.html?session_id=${SID}`);
}

test('fresh test_part starts at question 1', async ({ page }) => {
  await openTestPart(page, []);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 1 / 3', { timeout: 15000 });
});

test('refresh mid-test RESUMES at the first unanswered question', async ({ page }) => {
  await openTestPart(page, [Q[0], Q[1]]); // q1+q2 already graded server-side
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 3 / 3', { timeout: 15000 });
});

test('refresh after the LAST answer completes + hands off to the result page', async ({ page }) => {
  const calls = [];
  await openTestPart(page, Q, calls); // everything answered
  await page.waitForURL('**/result.html*', { timeout: 15000 });
  expect(page.url()).toContain(`id=${SID}`);
  expect(calls.some((c) => c === `PATCH /sessions/${SID}/complete`)).toBe(true);
});
