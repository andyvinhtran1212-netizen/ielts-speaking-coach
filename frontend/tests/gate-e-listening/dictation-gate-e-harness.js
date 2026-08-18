const { expect } = require('@playwright/test');

const API = 'http://localhost:8000';
const ORIGIN = 'http://localhost:3213';
const OWNER = '00000000-0000-4000-8000-0000000000bd';
const TEST_ID = 'LIS-GATE-E-DICTATION-1';
const RECEIPT_KEY = `av:dictation:v1:${OWNER}:${TEST_ID}:1`;
const SUPABASE_NEXT_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js';
const SUPABASE_LEGACY_CDNS = [
  'https://unpkg.com/@supabase/supabase-js@2.107.0',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0',
];
const LUCIDE_CDN = 'https://unpkg.com/lucide@1.17.0';
const PRODUCTION_ORIGINS = Object.freeze([
  'https://ielts-speaking-coach-production.up.railway.app',
  'https://huwsmtubwulikhlmcirx.supabase.co',
]);

const cors = {
  'access-control-allow-origin': ORIGIN,
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-request-id',
};

function dictationBundle() {
  return {
    id: TEST_ID,
    test_id: TEST_ID,
    title: 'Gate E Dictation fixture',
    audio_url: 'https://audio.test/dictation.mp3',
    audio_duration_seconds: 12,
    sections: [{
      section_num: 1,
      title: 'Section 1',
      cue_start: 0,
      sentences: ['Hello there.'],
      timings: [{ start: 0, end: 3 }],
      hints: [[]],
    }],
  };
}

function createDictationGateEState() {
  return {
    attempts: [],
    sessions: [],
    byRequest: new Map(),
    completionCalls: [],
    receiptReads: [],
    gradeCalls: [],
  };
}

function canonicalReport(body, sessionId) {
  const requestId = body.client_request_id || null;
  return {
    session_id: sessionId,
    attempt_id: body.attempt_id || null,
    client_request_id: requestId,
    test_title: 'Gate E Dictation fixture',
    section_num: 1,
    total_time_seconds: Number(body.total_time_seconds) || 1,
    total_sentences: 1,
    correct_count: 1,
    accuracy: 1,
    total_words: 2,
    correct_words: 2,
    error_trends: { op_counts: { miss: 0, wrong: 0, extra: 0 }, missed: {}, wrong: {} },
    results: [{
      sentence_idx: 0,
      score: 1,
      correct_words: 2,
      total_words: 2,
      user_text: String(body.sentences?.[0]?.user_transcript || ''),
      listen_count: Number(body.sentences?.[0]?.listen_count) || 0,
      time_seconds: Number(body.sentences?.[0]?.time_seconds) || 0,
      diff: [
        { op: 'match', actual: 'Hello', expected: 'Hello' },
        { op: 'match', actual: 'there.', expected: 'there.' },
      ],
    }],
  };
}

async function installDictationGateEHarness(page, { state, handleApi = null } = {}) {
  if (!state) throw new TypeError('state is required');
  const calls = [];
  const pageErrors = [];
  const productionRequests = [];

  const persist = (body) => {
    const requestId = body.client_request_id || null;
    if (requestId && state.byRequest.has(requestId)) return state.byRequest.get(requestId);
    const report = canonicalReport(body, `dictation-session-${state.sessions.length + 1}`);
    state.sessions.push({ body: structuredClone(body), report });
    const attempt = state.attempts.find((item) => item.attempt_id === body.attempt_id);
    if (attempt) attempt.status = 'completed';
    if (requestId) state.byRequest.set(requestId, report);
    return report;
  };

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (PRODUCTION_ORIGINS.some((origin) => request.url().startsWith(origin))) {
      productionRequests.push(request.url());
    }
  });

  await page.addInitScript(({ owner }) => {
    window.__GATE_E_LISTENING_SESSION__ = {
      access_token: 'gate-e-dictation-token',
      refresh_token: 'gate-e-dictation-refresh',
      expires_at: 4_102_444_800,
      user: { id: owner, email: 'gate-e-dictation@test.local' },
    };
  }, { owner: OWNER });

  const fulfillSupabase = (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.supabase={createClient:function(){return{auth:{getSession:async function(){return{data:{session:window.__GATE_E_LISTENING_SESSION__}}},onAuthStateChange:function(){return{data:{subscription:{unsubscribe:function(){}}}}},signOut:async function(){return{error:null}}}}}};`,
  });
  await page.route(SUPABASE_NEXT_CDN, fulfillSupabase);
  for (const cdn of SUPABASE_LEGACY_CDNS) await page.route(cdn, fulfillSupabase);
  await page.route(LUCIDE_CDN, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.lucide={createIcons:function(){}};',
  }));
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.route('https://audio.test/**', (route) => route.fulfill({
    status: 200,
    contentType: 'audio/mpeg',
    body: '',
  }));

  for (const origin of PRODUCTION_ORIGINS) {
    await page.route(`${origin}/**`, (route) => route.abort('blockedbyclient'));
  }

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body = null;
    try { body = request.postDataJSON(); } catch {}
    const entry = { method: request.method(), path: url.pathname, body, headers: request.headers() };
    calls.push(entry);

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/listening/tests/${TEST_ID}/dictation`) {
      await route.fulfill({ json: dictationBundle(), headers: cors });
      return;
    }
    if (request.method() === 'GET'
        && url.pathname === `/api/listening/tests/${TEST_ID}/dictation/attempts/in-progress`) {
      const attempt = state.attempts.find((item) => item.status === 'in_progress') || null;
      await route.fulfill({ json: { attempt }, headers: cors });
      return;
    }
    if (request.method() === 'POST'
        && url.pathname === `/api/listening/tests/${TEST_ID}/dictation/attempts`) {
      const existing = state.attempts.find((item) => item.status === 'in_progress');
      if (existing) {
        await route.fulfill({ json: { ...existing, created: false }, headers: cors });
        return;
      }
      const attempt = {
        attempt_id: `10000000-0000-4000-8000-${String(state.attempts.length + 1).padStart(12, '0')}`,
        test_id: TEST_ID, section_num: 1, status: 'in_progress',
        renderer_affinity: body?.renderer_affinity_protocol === 'claim-v1' ? null : 'legacy',
        started_at: '2026-08-18T00:00:00Z', answers: [], created: true,
      };
      state.attempts.push(attempt);
      await route.fulfill({ json: attempt, headers: cors });
      return;
    }
    const affinityMatch = url.pathname.match(/^\/api\/listening\/tests\/dictation\/attempts\/([^/]+)\/renderer-affinity$/);
    if (request.method() === 'POST' && affinityMatch) {
      const attempt = state.attempts.find((item) => item.attempt_id === decodeURIComponent(affinityMatch[1]));
      if (!attempt || attempt.status !== 'in_progress') {
        await route.fulfill({ status: 404, json: { detail: 'attempt missing' }, headers: cors });
        return;
      }
      attempt.renderer_affinity = attempt.renderer_affinity || body?.renderer_affinity;
      await route.fulfill({ json: { attempt_id: attempt.attempt_id,
        renderer_affinity: attempt.renderer_affinity }, headers: cors });
      return;
    }
    const sentenceMatch = url.pathname.match(/^\/api\/listening\/tests\/dictation\/attempts\/([^/]+)\/sentences\/(\d+)$/);
    if (request.method() === 'POST' && sentenceMatch) {
      const attempt = state.attempts.find((item) => item.attempt_id === decodeURIComponent(sentenceMatch[1]));
      if (!attempt || attempt.status !== 'in_progress') {
        await route.fulfill({ status: 404, json: { detail: 'attempt missing' }, headers: cors });
        return;
      }
      const sentenceIdx = Number(sentenceMatch[2]);
      state.gradeCalls.push({ test_id: TEST_ID, section_num: 1,
        sentence_idx: sentenceIdx, user_transcript: body?.user_transcript });
      const answer = {
        sentence_idx: sentenceIdx, user_transcript: body?.user_transcript || '',
        score: 1, is_correct: true, correct_words: 2, total_words: 2,
        listen_count: Number(body?.listen_count) || 0,
        time_seconds: Number(body?.time_seconds) || 0,
        diff: [
          { op: 'match', actual: 'Hello', expected: 'Hello' },
          { op: 'match', actual: 'there.', expected: 'there.' },
        ],
      };
      attempt.answers = attempt.answers.filter((item) => item.sentence_idx !== sentenceIdx);
      attempt.answers.push(answer);
      await route.fulfill({ json: answer, headers: cors });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/listening/tests/dictation/grade') {
      state.gradeCalls.push(structuredClone(body));
      await route.fulfill({
        json: {
          score: 1,
          is_correct: true,
          correct_words: 2,
          total_words: 2,
          diff: [
            { op: 'match', actual: 'Hello', expected: 'Hello' },
            { op: 'match', actual: 'there.', expected: 'there.' },
          ],
        },
        headers: cors,
      });
      return;
    }
    if (request.method() === 'GET' && url.pathname.startsWith('/api/listening/tests/dictation/session/by-request/')) {
      const requestId = decodeURIComponent(url.pathname.split('/').pop() || '');
      state.receiptReads.push(requestId);
      const report = state.byRequest.get(requestId);
      await route.fulfill(report
        ? { json: report, headers: cors }
        : { status: 404, json: { detail: 'not found' }, headers: cors });
      return;
    }
    if (request.method() === 'POST' && url.pathname === '/api/listening/tests/dictation/session') {
      state.completionCalls.push(structuredClone(body));
      if (handleApi && await handleApi({ route, request, url, entry, state, calls, persist, cors })) return;
      await route.fulfill({ json: persist(body), headers: cors });
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/auth/me') {
      await route.fulfill({ json: { id: OWNER, display_name: 'Dictation fixture' }, headers: cors });
      return;
    }
    if (url.pathname === '/api/analytics/events' || url.pathname === '/api/error-logs') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { detail: `fixture route missing: ${request.method()} ${url.pathname}` },
      headers: cors,
    });
  });

  return { calls, pageErrors, productionRequests };
}

async function openNextDictation(page) {
  await page.goto(`/listening/dictation/session?test_id=${TEST_ID}`);
  await expect(page.getByRole('heading', { name: 'Chép chính tả · Gate E Dictation fixture' })).toBeVisible();
  await expect(page.getByLabel('Câu trả lời câu 1')).toBeVisible();
}

async function completeNextDictation(page) {
  await page.getByLabel('Câu trả lời câu 1').fill('Hello there.');
  await page.getByRole('button', { name: 'Kiểm tra câu' }).click();
  await expect(page.getByText('100% · 2/2 từ')).toBeVisible();
  await page.getByRole('button', { name: 'Xem tổng kết' }).click();
}

async function openLegacyDictation(page) {
  await page.goto(`/pages/listening-test-dictation.html?test_id=${TEST_ID}`);
  await expect(page.locator('#dictation-surface')).toBeVisible();
  await expect(page.locator('#test-title')).toHaveText('Gate E Dictation fixture');
}

async function completeLegacyDictation(page) {
  await page.locator('#answer').fill('Hello there.');
  await page.locator('#btn-submit').click();
  await expect(page.locator('#score-pill')).toContainText('100%');
  await page.locator('#btn-next').click();
  await expect(page.locator('#completion-surface')).toBeVisible();
}

async function expectNoDictationHarnessErrors({ pageErrors, productionRequests }) {
  expect(pageErrors).toEqual([]);
  expect(productionRequests).toEqual([]);
}

module.exports = {
  OWNER,
  RECEIPT_KEY,
  TEST_ID,
  completeLegacyDictation,
  completeNextDictation,
  createDictationGateEState,
  expectNoDictationHarnessErrors,
  installDictationGateEHarness,
  openLegacyDictation,
  openNextDictation,
};
