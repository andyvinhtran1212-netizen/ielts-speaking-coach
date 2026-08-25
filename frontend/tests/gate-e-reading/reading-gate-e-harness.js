const { expect } = require('@playwright/test');

const API = 'http://localhost:8000';
const ORIGIN = 'http://localhost:3212';
const OWNER = '00000000-0000-4000-8000-0000000000bb';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const TEST_ID = 'RD-GATE-E-1';
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
  'access-control-allow-headers': 'authorization,content-type,x-reading-anon,x-reading-password,x-request-id',
};

function readingBundle() {
  return {
    test_id: TEST_ID,
    title: 'Gate E Reading fixture',
    module: 'academic',
    time_limit_minutes: 60,
    total_questions: 3,
    updated_at: '2026-08-11T00:00:00.000Z',
    passages: [{
      id: 'p1',
      passage_order: 1,
      title: 'Canonical persistence',
      body_markdown: 'Paragraph A explains the **first idea**.',
    }],
    questions: [
      {
        q_num: 1,
        passage_order: 1,
        question_type: 'short_answer',
        prompt: 'What idea is explained?',
      },
      {
        q_num: 2,
        passage_order: 1,
        question_type: 'true_false_not_given',
        prompt: 'The passage has an idea.',
      },
      {
        q_num: 3,
        passage_order: 1,
        question_type: 'mcq_single',
        prompt: 'Choose one.',
        payload: { options: [{ label: 'A', text: 'First' }, { label: 'B', text: 'Second' }] },
      },
    ],
  };
}

function createReadingGateEState({
  status = 'not_started',
  startedAt = new Date(Date.now() - 10_000).toISOString(),
  answers = [],
} = {}) {
  return {
    attemptId: ATTEMPT,
    rendererAffinity: null,
    status,
    startedAt,
    timeLimitMinutes: 60,
    answers: new Map(answers.map(({ q_num, user_answer }) => [Number(q_num), String(user_answer)])),
    bootCount: 0,
    startCount: 0,
    patchCalls: [],
    submitCalls: [],
  };
}

function inProgressPayload(state) {
  if (state.status !== 'in_progress') return null;
  return {
    attempt_id: state.attemptId,
    started_at: state.startedAt,
    time_limit_minutes: state.timeLimitMinutes,
    renderer_affinity: state.rendererAffinity,
    answers: [...state.answers].map(([q_num, user_answer]) => ({ q_num, user_answer })),
  };
}

function resultPayload(state) {
  const expected = new Map([[1, 'first idea'], [2, 'TRUE'], [3, 'A']]);
  const rows = readingBundle().questions.map(({ q_num }) => {
    const userAnswer = state.answers.get(q_num) || '';
    return {
      q_num,
      user_answer: userAnswer,
      expected: expected.get(q_num) || '',
      correct: userAnswer.trim().toUpperCase() === (expected.get(q_num) || '').toUpperCase(),
    };
  });
  return {
    attempt_id: state.attemptId,
    score: rows.filter(({ correct }) => correct).length,
    max_score: rows.length,
    band_estimate: 7,
    per_question: rows,
  };
}

async function installReadingGateEHarness(page, {
  state,
  handleApi = null,
  allowCrossRendererFixture = false,
} = {}) {
  if (!state) throw new TypeError('state is required');
  const calls = [];
  const pageErrors = [];
  const productionRequests = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (PRODUCTION_ORIGINS.some((origin) => request.url().startsWith(origin))) {
      productionRequests.push(request.url());
    }
  });

  await page.addInitScript(({ owner }) => {
    window.__GATE_E_READING_SESSION__ = {
      access_token: 'gate-e-reading-token',
      refresh_token: 'gate-e-reading-refresh',
      expires_at: 4_102_444_800,
      user: { id: owner, email: 'gate-e-reading@test.local' },
    };
  }, { owner: OWNER });

  const fulfillSupabase = (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.supabase={createClient:function(){return{auth:{getSession:async function(){return{data:{session:window.__GATE_E_READING_SESSION__}}},onAuthStateChange:function(){return{data:{subscription:{unsubscribe:function(){}}}}},signOut:async function(){return{error:null}}}}}};`,
  });
  await page.route(SUPABASE_NEXT_CDN, fulfillSupabase);
  for (const cdn of SUPABASE_LEGACY_CDNS) await page.route(cdn, fulfillSupabase);
  await page.route(LUCIDE_CDN, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.lucide={createIcons:function(){}};',
  }));
  await page.route('https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.marked={parse:function(s){return "<p>"+s+"</p>"}};',
  }));
  await page.route('https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.DOMPurify={sanitize:function(s){return s}};',
  }));
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());

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
    if (handleApi && await handleApi({ route, request, url, entry, state, calls })) return;

    if (request.method() === 'GET' && url.pathname === `/api/reading/test/${TEST_ID}/boot`) {
      state.bootCount += 1;
      await route.fulfill({ json: { test: readingBundle(), in_progress: inProgressPayload(state) }, headers: cors });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/reading/test/${TEST_ID}/attempts`) {
      state.startCount += 1;
      state.status = 'in_progress';
      state.startedAt = new Date(Date.now() - 10_000).toISOString();
      state.answers.clear();
      state.rendererAffinity = body?.renderer_affinity_protocol === 'claim-v1' ? null : 'legacy';
      await route.fulfill({
        json: {
          attempt_id: state.attemptId,
          started_at: state.startedAt,
          time_limit_minutes: state.timeLimitMinutes,
          renderer_affinity: state.rendererAffinity,
        },
        headers: cors,
      });
      return;
    }
    if (request.method() === 'POST'
        && url.pathname === `/api/reading/test/attempts/${state.attemptId}/renderer-affinity`) {
      if (allowCrossRendererFixture) {
        // This explicit synthetic seam exercises wire compatibility across
        // both implementations. Production never enables it; the live
        // coexistence drill separately proves first-claim-wins affinity.
        await route.fulfill({
          json: { attempt_id: state.attemptId, renderer_affinity: body?.renderer_affinity },
          headers: cors,
        });
        return;
      }
      state.rendererAffinity = state.rendererAffinity || body?.renderer_affinity;
      await route.fulfill({
        json: { attempt_id: state.attemptId, renderer_affinity: state.rendererAffinity },
        headers: cors,
      });
      return;
    }
    if (request.method() === 'PATCH' && url.pathname === `/api/reading/test/attempts/${state.attemptId}/answers`) {
      const patch = { q_num: Number(body?.q_num), user_answer: String(body?.user_answer ?? '') };
      state.patchCalls.push(patch);
      if (patch.user_answer) state.answers.set(patch.q_num, patch.user_answer);
      else state.answers.delete(patch.q_num);
      await route.fulfill({
        json: { attempt_id: state.attemptId, q_num: patch.q_num, answered: state.answers.size },
        headers: cors,
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/reading/test/attempts/${state.attemptId}/submit`) {
      const submitted = Array.isArray(body?.answers) ? body.answers : [];
      state.submitCalls.push(submitted.map((answer) => ({ ...answer })));
      for (const answer of submitted) {
        const qNum = Number(answer.q_num);
        const value = String(answer.user_answer ?? '');
        if (value) state.answers.set(qNum, value); else state.answers.delete(qNum);
      }
      state.status = 'submitted';
      await route.fulfill({ json: resultPayload(state), headers: cors });
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/reading/diagnostic') {
      await route.fulfill({ json: { skills: [], focus_skills: [] }, headers: cors });
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

async function openNext(page) {
  await page.goto(`/reading/exam/session?test_id=${TEST_ID}`);
  await expect(page.getByRole('heading', { name: 'Gate E Reading fixture' })).toBeVisible();
}

async function openLegacy(page) {
  await page.goto(`/pages/reading-exam.html?test_id=${TEST_ID}`);
  await expect(page.locator('#state-prestart')).toBeVisible();
  await expect(page.locator('#prestart-title')).toHaveText('Gate E Reading fixture');
}

async function expectNoHarnessErrors({ pageErrors, productionRequests }) {
  expect(pageErrors).toEqual([]);
  expect(productionRequests).toEqual([]);
}

module.exports = {
  ATTEMPT,
  TEST_ID,
  cors,
  createReadingGateEState,
  expectNoHarnessErrors,
  installReadingGateEHarness,
  openLegacy,
  openNext,
};
