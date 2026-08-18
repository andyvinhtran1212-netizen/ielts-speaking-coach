// Gate E — the rollback page and the Next route must resume from the same
// canonical response ledger in either direction within the supported
// same-origin, same-tab coexistence boundary.
const { test, expect } = require('@playwright/test');
const {
  OWNER,
  SID,
  cors,
  installHarness,
} = require('./native-speaking-harness');

const affinityRequirement = process.env.GATE_E_REQUIRE_AFFINITY;
if (affinityRequirement && !['true', 'false'].includes(affinityRequirement)) {
  throw new Error('GATE_E_REQUIRE_AFFINITY must be true or false when set');
}
const requireAffinity = affinityRequirement === 'true';

function isExpectedWebKitRedirectCancellation(message) {
  return /(?:\/speaking\?_rsc=[^ ]+|\/localhost:8000\/auth\/me) due to access control checks\.$/
    .test(message);
}

function questions() {
  return Array.from({ length: 9 }, (_, index) => ({
    id: `q${index + 1}`,
    part: 1,
    order_num: index + 1,
    question_text: `Part 1 question ${index + 1}?`,
    subtopic: index < 3 ? 'Home' : index < 6 ? 'Work' : 'Hobbies',
  }));
}

async function captureAudioAcrossNavigations(page) {
  const payloads = [];
  await page.exposeFunction('__gateECaptureCrossVersionAudio', (payload) => {
    payloads.push(payload);
  });
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const body = args[1]?.body;
      if (body instanceof FormData) {
        const audio = body.get('audio_file');
        if (audio && typeof audio.arrayBuffer === 'function') {
          const bytes = await audio.arrayBuffer();
          await window.__gateECaptureCrossVersionAudio(
            Array.from(new Uint8Array(bytes)),
          );
        }
      }
      return nativeFetch(...args);
    };
  });
  return payloads;
}

async function verifyNextClaimRejectsLegacyReopen(page) {
  const persisted = [];
  const uploads = [];
  const audioPayloads = await captureAudioAcrossNavigations(page);
  const session = () => ({
    id: SID,
    session_id: SID,
    mode: 'test_full',
    part: 1,
    topic: 'Home|||Work|||Hobbies',
    status: 'in_progress',
    results_sealed: false,
    responses: persisted.map((row) => ({ ...row })),
    response_receipts: [],
  });

  const { calls, pageErrors } = await installHarness(page, {
    session,
    questions: questions(),
    routePath: '/practice/session',
    handleApi: async ({ route, request, path }) => {
      if (request.method() === 'GET' && path === '/auth/me') {
        await route.fulfill({
          json: { id: OWNER, email: 'gate-e@test.local', full_name: 'Gate E Learner' },
          headers: cors,
        });
        return true;
      }
      if (request.method() !== 'POST' || path !== `/sessions/${SID}/responses`) return false;
      const body = request.postDataBuffer()?.toString('utf8') || '';
      const questionId = body.match(/name="question_id"\r\n\r\n([^\r\n]+)/)?.[1] || 'missing';
      uploads.push({ questionId });
      if (!persisted.some((row) => row.question_id === questionId)) {
        persisted.push({ id: `response-${questionId}`, question_id: questionId });
      }
      await route.fulfill({
        json: { response_id: `response-${questionId}` },
        headers: cors,
      });
      return true;
    },
  });

  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 1 / 9');
  expect(await page.evaluate(() => ({
    hasNativePlayer: typeof window.PracticePlayer?.showState === 'function',
    hasSubmission: typeof window.PracticeSubmission?.submit === 'function',
    hasFullTest: typeof window.PracticeFullTest?.restore === 'function',
  }))).toEqual({ hasNativePlayer: true, hasSubmission: true, hasFullTest: true });

  await page.evaluate(async (sessionId) => {
    await window.PracticeFullTest.submitAnswer({
      sessionId,
      questionId: 'q1',
      blob: new Blob([new Uint8Array([4, 3, 2, 1])], { type: 'audio/webm' }),
    });
  }, SID);

  await page.waitForLoadState('networkidle');
  await page.goto(`/pages/practice.html?session_id=${encodeURIComponent(SID)}`);
  await page.waitForURL(`**/practice/session?session_id=${encodeURIComponent(SID)}`);
  await expect(page.locator('#state-loading')).not.toHaveClass(/\bactive\b/);
  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 2 / 9');
  expect(await page.evaluate(() => typeof window.PracticePlayer?.showState === 'function')).toBe(true);
  // Let the redirected App Router/auth reads settle before the deliberate
  // reload. Synthetic iPhone WebKit otherwise reports the cancelled /auth/me
  // transport as a pageerror even though the canonical redirect has finished.
  await page.waitForLoadState('networkidle');

  await page.evaluate(async (sessionId) => {
    await window.PracticeFullTest.submitAnswer({
      sessionId,
      questionId: 'q2',
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }),
    });
  }, SID);

  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(page.locator('#state-loading')).not.toHaveClass(/\bactive\b/);
  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 3 / 9');

  expect(uploads.map((upload) => upload.questionId)).toEqual(['q1', 'q2']);
  expect(audioPayloads).toEqual([[4, 3, 2, 1], [1, 2, 3, 4]]);
  expect(calls.filter((call) => call === `GET /sessions/${SID}`)).toHaveLength(3);
  expect(calls.filter((call) => call === `GET /sessions/${SID}/questions`)).toHaveLength(3);
  expect(calls.filter((call) =>
    call === `POST /sessions/${SID}/renderer-affinity`
  )).toHaveLength(4);
  expect(await page.evaluate((sessionId) => {
    const state = JSON.parse(sessionStorage.getItem('ielts_ft_state_v2') || 'null');
    return { ownerId: state?.owner_id, confirmed: state?.confirmed?.[sessionId] };
  }, SID)).toEqual({ ownerId: OWNER, confirmed: ['q1', 'q2'] });
  expect(pageErrors.filter((message) => !isExpectedWebKitRedirectCancellation(message)))
    .toEqual([]);
}

test('persisted affinity resumes canonically in both Legacy and Next directions', async ({ page, context }) => {
  const persisted = [];
  const uploads = [];
  const audioPayloads = await captureAudioAcrossNavigations(page);
  const session = () => ({
    id: SID,
    session_id: SID,
    mode: 'test_full',
    part: 1,
    topic: 'Home|||Work|||Hobbies',
    status: 'in_progress',
    results_sealed: false,
    responses: persisted.map((row) => ({ ...row })),
    response_receipts: [],
  });

  const { calls, pageErrors } = await installHarness(page, {
    session,
    questions: questions(),
    routePath: '/pages/practice.html',
    handleApi: async ({ route, request, path }) => {
      if (request.method() === 'GET' && path === '/auth/me') {
        await route.fulfill({
          json: { id: OWNER, email: 'gate-e@test.local', full_name: 'Gate E Learner' },
          headers: cors,
        });
        return true;
      }
      if (request.method() !== 'POST' || path !== `/sessions/${SID}/responses`) return false;
      const body = request.postDataBuffer()?.toString('utf8') || '';
      const questionId = body.match(/name="question_id"\r\n\r\n([^\r\n]+)/)?.[1] || 'missing';
      uploads.push({ questionId });
      if (!persisted.some((row) => row.question_id === questionId)) {
        persisted.push({ id: `response-${questionId}`, question_id: questionId });
      }
      await route.fulfill({
        json: { response_id: `response-${questionId}` },
        headers: cors,
      });
      return true;
    },
  });

  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 1 / 9');
  expect(await page.evaluate(() => ({
    hasLegacyRuntime: !!window.PracticeLegacyRuntime,
    hasSubmission: typeof window.PracticeSubmission?.submit === 'function',
    hasFullTest: typeof window.PracticeFullTest?.restore === 'function',
  }))).toEqual({ hasLegacyRuntime: true, hasSubmission: true, hasFullTest: true });

  await page.evaluate(async (sessionId) => {
    await window.PracticeFullTest.submitAnswer({
      sessionId,
      questionId: 'q1',
      blob: new Blob([new Uint8Array([0, 255, 128, 1, 2, 254])], { type: 'audio/webm' }),
    });
  }, SID);

  await page.goto(`/practice/session?session_id=${encodeURIComponent(SID)}`);
  if (requireAffinity) {
    await page.waitForURL(`**/pages/practice.html?session_id=${encodeURIComponent(SID)}`);
  } else {
    await page.waitForURL(`**/practice/session?session_id=${encodeURIComponent(SID)}`);
  }
  await expect(page.locator('#state-loading')).not.toHaveClass(/\bactive\b/);
  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 2 / 9');
  expect(await page.evaluate(() => !!window.PracticeLegacyRuntime)).toBe(requireAffinity);

  await page.evaluate(async (sessionId) => {
    await window.PracticeFullTest.submitAnswer({
      sessionId,
      questionId: 'q2',
      blob: new Blob([new Uint8Array([254, 2, 1, 128, 255, 0])], { type: 'audio/webm' }),
    });
  }, SID);

  // Do not wait for global networkidle before this deliberate full-document
  // handoff. App Router may keep the unrelated /speaking RSC prefetch open;
  // the destination load plus canonical state assertions below are the actual
  // synchronization boundary. The exact WebKit cancellation remains filtered
  // fail-closed at the end of the test.
  await page.goto(`/pages/practice.html?session_id=${encodeURIComponent(SID)}`);
  await expect(page.locator('#state-loading')).not.toHaveClass(/\bactive\b/);
  await expect(page.locator('#state-prep')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#prep-q-counter')).toHaveText('Câu 3 / 9');

  expect(uploads.map((upload) => upload.questionId)).toEqual(['q1', 'q2']);
  expect(audioPayloads).toEqual([
    [0, 255, 128, 1, 2, 254],
    [254, 2, 1, 128, 255, 0],
  ]);
  expect(calls.filter((call) => call === `GET /sessions/${SID}`)).toHaveLength(3);
  expect(calls.filter((call) => call === `GET /sessions/${SID}/questions`)).toHaveLength(3);
  expect(calls.filter((call) =>
    call === `POST /sessions/${SID}/renderer-affinity`
  )).toHaveLength(requireAffinity ? 4 : 0);
  expect(await page.evaluate((sessionId) => {
    const state = JSON.parse(sessionStorage.getItem('ielts_ft_state_v2') || 'null');
    return { ownerId: state?.owner_id, confirmed: state?.confirmed?.[sessionId] };
  }, SID)).toEqual({ ownerId: OWNER, confirmed: ['q1', 'q2'] });
  // The affinity mismatch intentionally performs an immediate full-document
  // redirect before App Router can settle its same-origin /speaking RSC
  // prefetch. Synthetic iPhone WebKit reports that cancelled prefetch, and on
  // some runs the in-flight synthetic `/auth/me`, as pageerrors even though the
  // canonical redirect and player state are intact. Keep every other pageerror
  // fail-closed; these exact transport-only cancellations are already bounded
  // by the final URL + canonical state assertions above.
  expect(pageErrors.filter((message) => !isExpectedWebKitRedirectCancellation(message)))
    .toEqual([]);

  // The trusted main auditor validates the N-1 runtime before affinity ships
  // there. Staging workflows always opt into this stricter two-way handoff.
  if (requireAffinity) {
    const nextPage = await context.newPage();
    await verifyNextClaimRejectsLegacyReopen(nextPage);
    await nextPage.close();
  }
});
