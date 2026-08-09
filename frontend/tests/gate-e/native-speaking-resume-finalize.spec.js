// Gate E exit 2: mutation/recovery evidence in a real hydrated browser. These
// tests use the production native controllers and multipart transport; only
// network responses are deterministic fixtures.
const { test, expect } = require('@playwright/test');
const {
  OWNER,
  SID,
  cors,
  installHarness,
} = require('./native-speaking-harness');

const P1 = '22222222-2222-4222-8222-222222222201';
const P2 = '22222222-2222-4222-8222-222222222202';
const P3 = SID;
const CHAIN = [P1, P2, P3];
const LEGACY_CHAIN_KEY = 'ielts_ft_session_ids';
const STATE_KEY = 'ielts_ft_state_v2';

function questions(part, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `q${index + 1}`,
    part,
    order_num: index + 1,
    question_text: `Part ${part} question ${index + 1}?`,
    ...(part === 1 ? { subtopic: index < 3 ? 'Home' : index < 6 ? 'Work' : 'Hobbies' } : {}),
  }));
}

function receipts(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `sealed-r${index + 1}`,
    question_id: `q${index + 1}`,
  }));
}

function fullSession(part, overrides = {}) {
  return {
    id: P3,
    session_id: P3,
    mode: 'test_full',
    part,
    topic: part === 1 ? 'Home|||Work|||Hobbies' : 'A useful skill',
    status: 'in_progress',
    results_sealed: true,
    sitting_id: '33333333-3333-4333-8333-333333333333',
    full_test_attempt_id: '44444444-4444-4444-8444-444444444444',
    responses: [],
    response_receipts: [],
    ...overrides,
  };
}

function chainStorage(confirmed = {}) {
  return {
    [LEGACY_CHAIN_KEY]: JSON.stringify(CHAIN),
    [STATE_KEY]: JSON.stringify({
      version: 2,
      owner_id: OWNER,
      session_ids: CHAIN,
      confirmed,
    }),
  };
}

function countCalls(calls, method, path) {
  return calls.filter((call) => call === `${method} ${path}`).length;
}

test('sealed upload committed before a network failure reconciles and survives reload', async ({ page }) => {
  let committed = false;
  const uploads = [];
  const session = () => fullSession(1, {
    response_receipts: committed ? [{ id: 'sealed-r1', question_id: 'q1' }] : [],
  });

  const { calls, pageErrors } = await installHarness(page, {
    session,
    questions: questions(1, 9),
    handleApi: async ({ route, request, path }) => {
      if (request.method() !== 'POST' || path !== `/sessions/${P3}/responses`) return false;
      uploads.push({
        authorization: request.headers().authorization || '',
        body: request.postDataBuffer()?.toString('utf8') || '',
      });
      // The server committed the row, but the connection died before the
      // browser received the response. Production must reconcile, not resend.
      committed = true;
      await route.abort('connectionreset');
      return true;
    },
  });

  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 1 / 9');
  const result = await page.evaluate(async ({ sessionId }) => {
    const blob = new Blob(['gate-e-original-audio'], { type: 'audio/webm' });
    return window.PracticeFullTest.submitAnswer({
      sessionId,
      questionId: 'q1',
      blob,
    });
  }, { sessionId: P3 });

  expect(result._reconciled).toBe(true);
  expect(result.response_id).toBe('sealed-r1');
  expect(uploads).toHaveLength(1);
  expect(uploads[0].authorization).toBe('Bearer gate-e-fake-token');
  expect(uploads[0].body).toContain('name="question_id"');
  expect(uploads[0].body).toContain('q1');
  expect(uploads[0].body).toContain('gate-e-original-audio');
  await expect.poll(() => page.evaluate(({ key, sessionId }) => {
    const state = JSON.parse(window.sessionStorage.getItem(key) || 'null');
    return state?.confirmed?.[sessionId] || [];
  }, { key: STATE_KEY, sessionId: P3 })).toEqual(['q1']);

  await page.reload();
  await expect(page.locator('#state-loading')).not.toHaveClass(/\bactive\b/);
  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 2 / 9');
  await expect(page.locator('body')).not.toContainText('sealed-r1');
  expect(countCalls(calls, 'POST', `/sessions/${P3}/responses`)).toBe(1);
  expect(countCalls(calls, 'GET', `/sessions/${P3}`)).toBe(3);
  expect(countCalls(calls, 'GET', `/sessions/${P3}/questions`)).toBe(2);
  expect(pageErrors).toEqual([]);
});

test('retry keeps the original failed blob, then finalizes the exact chain', async ({ page }) => {
  let uploadAttempt = 0;
  const uploadBodies = [];
  const finalizeBodies = [];
  const session = fullSession(3, {
    results_sealed: false,
    sitting_id: null,
    response_receipts: receipts(4),
  });

  const { pageErrors } = await installHarness(page, {
    session,
    questions: questions(3, 5),
    initStorage: chainStorage({ [P3]: ['q1', 'q2', 'q3', 'q4'] }),
    expectBootstrapOnce: false,
    handleApi: async ({ route, request, path }) => {
      if (request.method() === 'POST' && path === `/sessions/${P3}/responses`) {
        uploadAttempt += 1;
        uploadBodies.push(request.postDataBuffer()?.toString('utf8') || '');
        if (uploadAttempt === 1) {
          await route.abort('connectionreset');
          return true;
        }
        await route.fulfill({ json: { response_id: 'sealed-r5' }, headers: cors });
        return true;
      }
      if (request.method() === 'POST' && path === '/sessions/finalize-full-test') {
        finalizeBodies.push(request.postDataJSON());
        await route.fulfill({
          json: { accepted: true, session_ids: CHAIN },
          headers: cors,
        });
        return true;
      }
      return false;
    },
  });

  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 5 / 5');
  const failureCode = await page.evaluate(async ({ sessionId }) => {
    try {
      const blob = new Blob(['only-copy-audio-q5'], { type: 'audio/webm' });
      await window.PracticeFullTest.submitAnswer({
        sessionId,
        questionId: 'q5',
        blob,
      });
      return null;
    } catch (error) {
      return error?.code || 'unknown';
    }
  }, { sessionId: P3 });
  expect(failureCode).toBe('ambiguous_commit');
  expect(await page.evaluate(() => window.PracticeFullTest.getSnapshot().retryCount)).toBe(1);

  // Public production action: the completion retry first resends every local
  // blob, then crosses the finalize barrier. showState only moves the real
  // React player into the state where that action belongs.
  await page.evaluate(() => {
    window.PracticePlayer.showState('completion');
    window.PracticeApp.retryFullTestSubmissions();
  });
  await expect(page.locator('#state-completion')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#completion-submit-status')).toHaveText(
    'Đã xác nhận toàn bộ bản ghi trên máy chủ.',
  );
  await expect(page.locator('#completion-ctas')).toBeVisible();

  expect(uploadBodies).toHaveLength(2);
  expect(uploadBodies[0]).toContain('only-copy-audio-q5');
  expect(uploadBodies[1]).toContain('only-copy-audio-q5');
  expect(finalizeBodies).toEqual([{ p1_id: P1, p2_id: P2, p3_id: P3 }]);
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), STATE_KEY)).toBeNull();
  expect(pageErrors).toEqual([]);
});

test('failed finalize stays retryable and clears state only after acceptance', async ({ page }) => {
  const finalizeBodies = [];
  const session = fullSession(3, {
    results_sealed: false,
    sitting_id: null,
    response_receipts: receipts(5),
  });

  const { calls, pageErrors } = await installHarness(page, {
    session,
    questions: questions(3, 5),
    initStorage: chainStorage({ [P3]: ['q1', 'q2', 'q3', 'q4', 'q5'] }),
    expectBootstrapOnce: false,
    handleApi: async ({ route, request, path }) => {
      if (request.method() === 'GET' && (path === `/sessions/${P1}` || path === `/sessions/${P2}`)) {
        await route.fulfill({ json: { id: path.split('/').pop(), status: 'in_progress' }, headers: cors });
        return true;
      }
      if (request.method() === 'POST' && path === '/sessions/finalize-full-test') {
        finalizeBodies.push(request.postDataJSON());
        if (finalizeBodies.length === 1) {
          await route.fulfill({ status: 503, json: { detail: 'temporary gateway loss' }, headers: cors });
        } else {
          await route.fulfill({ json: { accepted: true, session_ids: CHAIN }, headers: cors });
        }
        return true;
      }
      return false;
    },
  });

  await expect(page.locator('#state-completion')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#completion-title')).toHaveText('Chưa chốt được Full Test');
  await expect(page.locator('#completion-retry-btn')).toBeVisible();
  await expect(page.locator('#completion-ctas')).toBeHidden();
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), STATE_KEY)).not.toBeNull();
  expect(finalizeBodies).toEqual([{ p1_id: P1, p2_id: P2, p3_id: P3 }]);

  await page.locator('#completion-retry-btn').click();
  await expect(page.locator('#completion-submit-status')).toHaveText(
    'Đã xác nhận toàn bộ bản ghi trên máy chủ.',
  );
  await expect(page.locator('#completion-retry-btn')).toBeHidden();
  await expect(page.locator('#completion-ctas')).toBeVisible();
  expect(finalizeBodies).toEqual([
    { p1_id: P1, p2_id: P2, p3_id: P3 },
    { p1_id: P1, p2_id: P2, p3_id: P3 },
  ]);
  expect(countCalls(calls, 'GET', `/sessions/${P1}`)).toBe(1);
  expect(countCalls(calls, 'GET', `/sessions/${P2}`)).toBe(1);
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), STATE_KEY)).toBeNull();
  expect(pageErrors).toEqual([]);
});

test('network-after-finalize-commit reconciles without a duplicate POST', async ({ page }) => {
  let committed = false;
  let finalizePosts = 0;
  const session = () => fullSession(3, {
    results_sealed: false,
    sitting_id: null,
    status: committed ? 'submitted' : 'in_progress',
    response_receipts: receipts(5),
  });

  const { calls, pageErrors } = await installHarness(page, {
    session,
    questions: questions(3, 5),
    initStorage: chainStorage({ [P3]: ['q1', 'q2', 'q3', 'q4', 'q5'] }),
    expectBootstrapOnce: false,
    handleApi: async ({ route, request, path }) => {
      if (request.method() === 'GET' && (path === `/sessions/${P1}` || path === `/sessions/${P2}`)) {
        await route.fulfill({
          json: { id: path.split('/').pop(), status: committed ? 'submitted' : 'in_progress' },
          headers: cors,
        });
        return true;
      }
      if (request.method() === 'POST' && path === '/sessions/finalize-full-test') {
        finalizePosts += 1;
        committed = true;
        await route.abort('connectionreset');
        return true;
      }
      return false;
    },
  });

  await expect(page.locator('#state-completion')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#completion-submit-status')).toHaveText(
    'Đã xác nhận toàn bộ bản ghi trên máy chủ.',
  );
  await expect(page.locator('#completion-retry-btn')).toBeHidden();
  await expect(page.locator('#completion-ctas')).toBeVisible();
  expect(finalizePosts).toBe(1);
  expect(countCalls(calls, 'POST', '/sessions/finalize-full-test')).toBe(1);
  expect(countCalls(calls, 'GET', `/sessions/${P1}`)).toBe(1);
  expect(countCalls(calls, 'GET', `/sessions/${P2}`)).toBe(1);
  expect(countCalls(calls, 'GET', `/sessions/${P3}`)).toBe(2);
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), STATE_KEY)).toBeNull();
  expect(pageErrors).toEqual([]);
});
