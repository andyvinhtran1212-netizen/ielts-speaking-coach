const { test, expect } = require('@playwright/test');
const { ATTEMPT, completionBundle, cors, installReadingHarness, testBundle } = require('./reading-native-harness');

test('boots the native dark route without starting an attempt', async ({ page }) => {
  const { calls } = await installReadingHarness(page);
  await expect(page.getByRole('heading', { name: 'Native Reading fixture' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bắt đầu bài thi' })).toBeVisible();
  expect(calls.filter((call) => call.path.endsWith('/boot'))).toHaveLength(1);
  expect(calls.some((call) => call.path.endsWith('/attempts'))).toBe(false);
});

test('rehydrates the canonical server attempt and continues its timer', async ({ page }) => {
  const started = new Date(Date.now() - 10_000).toISOString();
  await installReadingHarness(page, {
    inProgress: {
      attempt_id: ATTEMPT,
      started_at: started,
      time_limit_minutes: 60,
      answers: [{ q_num: 1, user_answer: 'restored answer' }],
    },
    handleApi: async ({ route, request, url }) => {
      if (request.method() === 'PATCH' && url.pathname.endsWith('/answers')) {
        await route.fulfill({ json: { attempt_id: ATTEMPT, q_num: 1, answered: 1 }, headers: cors });
        return true;
      }
      return false;
    },
  });
  await page.getByRole('button', { name: 'Tiếp tục bài đang làm' }).click();
  await expect(page.getByLabel('Answer 1')).toHaveValue('restored answer');
  await expect(page.getByRole('timer')).toContainText('59:');
});

test('starts, autosaves and submits the complete in-memory answer set', async ({ page }) => {
  let submittedBody = null;
  const { calls } = await installReadingHarness(page, {
    handleApi: async ({ route, request, url }) => {
      if (request.method() === 'POST' && url.pathname === '/api/reading/test/RD-NATIVE-1/attempts') {
        await route.fulfill({ json: { attempt_id: ATTEMPT, started_at: new Date().toISOString(), time_limit_minutes: 60 }, headers: cors });
        return true;
      }
      if (request.method() === 'PATCH' && url.pathname === `/api/reading/test/attempts/${ATTEMPT}/answers`) {
        await route.fulfill({ json: { attempt_id: ATTEMPT, answered: 1 }, headers: cors });
        return true;
      }
      if (request.method() === 'POST' && url.pathname === `/api/reading/test/attempts/${ATTEMPT}/submit`) {
        submittedBody = request.postDataJSON();
        await route.fulfill({
          json: {
            attempt_id: ATTEMPT, score: 3, max_score: 3, band_estimate: 7,
            per_question: [
              { q_num: 1, user_answer: 'first idea', correct: true },
              { q_num: 2, user_answer: 'TRUE', correct: true },
              { q_num: 3, user_answer: 'A', correct: true },
            ],
          },
          headers: cors,
        });
        return true;
      }
      return false;
    },
  });

  await page.getByRole('button', { name: 'Bắt đầu bài thi' }).click();
  await page.getByLabel('Answer 1').fill('first idea');
  await page.getByLabel('Answer 2').selectOption('TRUE');
  await page.getByRole('radio', { name: /First/ }).check();
  await expect.poll(() => calls.filter((call) => call.method === 'PATCH').length).toBeGreaterThanOrEqual(3);
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kết quả' })).toBeVisible();
  expect(submittedBody.answers).toEqual([
    { q_num: 1, user_answer: 'first idea' },
    { q_num: 2, user_answer: 'TRUE' },
    { q_num: 3, user_answer: 'A' },
  ]);
});

test('anonymous share boot and save carry the minted capability token', async ({ page }) => {
  let saveHeader = null;
  await installReadingHarness(page, {
    signedIn: false,
    route: '/reading/exam/session?share=share-token&from=mini',
    handleApi: async ({ route, request, url }) => {
      if (request.method() === 'GET' && url.pathname === '/api/reading/test/share/share-token/boot') {
        await route.fulfill({ json: { test: testBundle(), in_progress: null }, headers: cors });
        return true;
      }
      if (request.method() === 'POST' && url.pathname === '/api/reading/test/share/share-token/attempts') {
        await route.fulfill({ json: { attempt_id: ATTEMPT, anon_id: 'anon-capability', started_at: new Date().toISOString(), time_limit_minutes: 60 }, headers: cors });
        return true;
      }
      if (request.method() === 'PATCH' && url.pathname.endsWith('/answers')) {
        saveHeader = request.headers()['x-reading-anon'];
        await route.fulfill({ json: { attempt_id: ATTEMPT, answered: 1 }, headers: cors });
        return true;
      }
      if (request.method() === 'POST' && url.pathname.endsWith('/submit')) {
        await route.fulfill({
          json: { attempt_id: ATTEMPT, score: 1, max_score: 3, band_estimate: 4, per_question: [] },
          headers: cors,
        });
        return true;
      }
      return false;
    },
  });
  await page.getByRole('button', { name: 'Bắt đầu bài thi' }).click();
  await page.getByLabel('Answer 1').fill('guest answer');
  await expect.poll(() => saveHeader).toBe('anon-capability');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
  await expect(page.getByRole('link', { name: /Xem chữa bài chi tiết/ })).toHaveAttribute(
    'href',
    `/reading/review?attempt_id=${ATTEMPT}&anon=anon-capability&from=mini`,
  );
});

test('shared attempt survives cross-tab sign-in and sign-out without rebooting', async ({ page }) => {
  const inProgress = {
    attempt_id: ATTEMPT,
    anon_id: 'anon-capability',
    started_at: new Date().toISOString(),
    time_limit_minutes: 60,
    answers: [{ q_num: 1, user_answer: 'server answer' }],
  };
  const { calls } = await installReadingHarness(page, {
    signedIn: false,
    route: '/reading/exam/session?share=share-token&from=mini',
    handleApi: async ({ route, request, url }) => {
      if (request.method() === 'GET' && url.pathname === '/api/reading/test/share/share-token/boot') {
        await route.fulfill({ json: { test: testBundle(), in_progress: inProgress }, headers: cors });
        return true;
      }
      if (request.method() === 'PATCH' && url.pathname.endsWith('/answers')) {
        await route.fulfill({ json: { attempt_id: ATTEMPT, answered: 1 }, headers: cors });
        return true;
      }
      return false;
    },
  });
  await page.getByRole('button', { name: 'Tiếp tục bài đang làm' }).click();
  await page.getByLabel('Answer 1').fill('pending guest answer');

  await page.evaluate(() => window.__emitReadingNativeAuth({
    access_token: 'cross-tab-token',
    user: { id: 'cross-tab-user', email: 'cross-tab@test.local' },
  }));
  await expect(page.getByLabel('Answer 1')).toHaveValue('pending guest answer');
  await page.evaluate(() => window.__emitReadingNativeAuth(null));
  await expect(page.getByLabel('Answer 1')).toHaveValue('pending guest answer');
  expect(calls.filter((call) => call.path.endsWith('/boot'))).toHaveLength(1);
});

test('renders and restores every shared completion format as one consecutive run', async ({ page }) => {
  const bundle = completionBundle();
  const restored = bundle.questions.map((question) => ({
    q_num: question.q_num,
    user_answer: [3, 4].includes(question.q_num) ? (question.q_num === 3 ? 'A' : 'B') : `answer-${question.q_num}`,
  }));
  await installReadingHarness(page, {
    bundle,
    inProgress: {
      attempt_id: ATTEMPT,
      started_at: new Date(Date.now() - 5_000).toISOString(),
      time_limit_minutes: 60,
      answers: restored,
    },
  });
  await page.getByRole('button', { name: 'Tiếp tục bài đang làm' }).click();
  await expect(page.locator('.exam-questions__group')).toHaveCount(7);
  await expect(page.locator('.exam-questions__instructions').first()).toContainText('ONE WORD ONLY');
  await expect(page.getByText('(see summary above)')).toHaveCount(0);
  await expect(page.locator('.reading-next-question-bank')).toHaveCount(1);
  await expect(page.locator('.exam-diagram-image')).toHaveCount(1);
  for (const question of bundle.questions) {
    await expect(page.getByLabel(`Answer ${question.q_num}`, { exact: true })).toHaveValue(
      [3, 4].includes(question.q_num) ? (question.q_num === 3 ? 'A' : 'B') : `answer-${question.q_num}`,
    );
  }
});

test('wrong password retry returns to a recoverable error instead of hanging', async ({ page }) => {
  const replies = ['wrong-password', 'correct-password'];
  page.on('dialog', (dialog) => dialog.accept(replies.shift() || ''));
  await installReadingHarness(page, {
    handleApi: async ({ route, request, url }) => {
      if (request.method() !== 'GET' || !url.pathname.endsWith('/boot')) return false;
      if (request.headers()['x-reading-password'] !== 'correct-password') {
        await route.fulfill({ status: 403, json: { detail: 'wrong password' }, headers: cors });
      } else {
        await route.fulfill({ json: { test: testBundle(), in_progress: null }, headers: cors });
      }
      return true;
    },
  });
  await expect(page.locator('p[role="alert"]')).toContainText('Không tải được bài thi');
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('heading', { name: 'Native Reading fixture' })).toBeVisible();
});

test('pagehide flushes an answer that is still inside the debounce window', async ({ page }) => {
  let saved = null;
  await installReadingHarness(page, {
    handleApi: async ({ route, request, url }) => {
      if (request.method() === 'POST' && url.pathname.endsWith('/attempts')) {
        await route.fulfill({ json: { attempt_id: ATTEMPT, started_at: new Date().toISOString(), time_limit_minutes: 60 }, headers: cors });
        return true;
      }
      if (request.method() === 'PATCH' && url.pathname.endsWith('/answers')) {
        saved = request.postDataJSON();
        await route.fulfill({ json: { attempt_id: ATTEMPT, answered: 1 }, headers: cors });
        return true;
      }
      return false;
    },
  });
  await page.getByRole('button', { name: 'Bắt đầu bài thi' }).click();
  await page.getByLabel('Answer 1').fill('leave safely');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => saved).toEqual({ q_num: 1, user_answer: 'leave safely' });
});

test('pagehide re-sends the latest answer while a normal save is still in flight', async ({ page }) => {
  let patchCalls = 0;
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  await installReadingHarness(page, {
    handleApi: async ({ route, request, url }) => {
      if (request.method() === 'POST' && url.pathname.endsWith('/attempts')) {
        await route.fulfill({ json: { attempt_id: ATTEMPT, started_at: new Date().toISOString(), time_limit_minutes: 60 }, headers: cors });
        return true;
      }
      if (request.method() === 'PATCH' && url.pathname.endsWith('/answers')) {
        patchCalls += 1;
        if (patchCalls === 1) await firstPending;
        await route.fulfill({ json: { attempt_id: ATTEMPT, answered: 1 }, headers: cors });
        return true;
      }
      return false;
    },
  });
  await page.getByRole('button', { name: 'Bắt đầu bài thi' }).click();
  await page.getByLabel('Answer 1').fill('keepalive replacement');
  await expect.poll(() => patchCalls).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => patchCalls).toBe(2);
  releaseFirst();
});
