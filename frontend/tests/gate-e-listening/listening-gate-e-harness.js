const { expect } = require('@playwright/test');

const API = 'http://localhost:8000';
const ORIGIN = 'http://localhost:3213';
const OWNER = '00000000-0000-4000-8000-0000000000bc';
const ATTEMPT = '11111111-1111-4111-8111-111111111112';
const TEST_ID = 'LIS-GATE-E-1';
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

function listeningBundle() {
  return {
    id: TEST_ID,
    test_id: TEST_ID,
    title: 'Gate E Listening fixture',
    test_type: 'full',
    audio_url: 'data:audio/wav;base64,UklGRg==',
    audio_duration_seconds: 120,
    cue_points: [],
    sections: [{
      section_num: 1,
      title: 'Part 1',
      exercises: [{
        id: 'ex-1',
        exercise_type: 'dictation',
        payload: {
          template_kind: 'form_completion',
          instruction: 'Write ONE WORD for each answer.',
          questions: [
            { q_num: 1, prompt: 'Meet at ____' },
            { q_num: 2, prompt: 'Wear ____' },
          ],
          template: {
            heading: 'Booking form',
            rows: [
              { label: 'Place', q_num: 1, prefix: 'Meet at' },
              { label: 'Colour', q_num: 2, prefix: 'Wear' },
            ],
          },
        },
      }],
    }],
  };
}

function createListeningGateEState({
  status = 'not_started',
  startedAt = new Date(Date.now() - 30_000).toISOString(),
  answers = [],
} = {}) {
  return {
    attemptId: ATTEMPT,
    status,
    startedAt,
    answers: new Map(answers.map(({ q_num, user_answer }) => [Number(q_num), String(user_answer)])),
    testReads: 0,
    resumeReads: 0,
    startCount: 0,
    patchCalls: [],
    submitCalls: [],
  };
}

function inProgressPayload(state) {
  if (state.status !== 'in_progress') return { attempt: null };
  return {
    attempt: {
      attempt_id: state.attemptId,
      started_at: state.startedAt,
      answers: [...state.answers].map(([q_num, user_answer]) => ({ q_num, user_answer })),
    },
  };
}

function resultPayload(state) {
  const expected = new Map([[1, 'library'], [2, 'blue']]);
  const rows = [...expected].map(([q_num, answer]) => {
    const userAnswer = state.answers.get(q_num) || '';
    return {
      q_num,
      user_answer: userAnswer,
      expected: answer,
      correct: userAnswer.trim().toLowerCase() === answer,
    };
  });
  return {
    attempt_id: state.attemptId,
    score: rows.filter(({ correct }) => correct).length,
    max_score: rows.length,
    band_estimate: 7,
    section_breakdown: { s1: { correct: rows.filter(({ correct }) => correct).length, total: rows.length } },
    trap_analytics: {},
    per_question: rows,
  };
}

async function installListeningGateEHarness(page, { state, handleApi = null } = {}) {
  if (!state) throw new TypeError('state is required');
  const calls = [];
  const pageErrors = [];
  const productionRequests = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', async (dialog) => dialog.accept());
  page.on('request', (request) => {
    if (PRODUCTION_ORIGINS.some((origin) => request.url().startsWith(origin))) {
      productionRequests.push(request.url());
    }
  });

  await page.addInitScript(({ owner }) => {
    window.__GATE_E_LISTENING_SESSION__ = {
      access_token: 'gate-e-listening-token',
      refresh_token: 'gate-e-listening-refresh',
      expires_at: 4_102_444_800,
      user: { id: owner, email: 'gate-e-listening@test.local' },
    };
    // Deterministic metadata/currentTime across Chromium and WebKit. The
    // fixture does not decode media; it verifies the player's resume anchor.
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
      configurable: true,
      get() { return 120; },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() { return this.__gateECurrentTime || 0; },
      set(value) { this.__gateECurrentTime = Number(value) || 0; },
    });
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

    if (request.method() === 'GET' && url.pathname === `/api/listening/tests/${TEST_ID}`) {
      state.testReads += 1;
      await route.fulfill({ json: listeningBundle(), headers: cors });
      return;
    }
    if (request.method() === 'GET' && url.pathname === `/api/listening/tests/${TEST_ID}/attempts/in-progress`) {
      state.resumeReads += 1;
      await route.fulfill({ json: inProgressPayload(state), headers: cors });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/listening/tests/${TEST_ID}/attempts`) {
      state.startCount += 1;
      state.status = 'in_progress';
      state.startedAt = new Date(Date.now() - 30_000).toISOString();
      state.answers.clear();
      await route.fulfill({
        json: { attempt_id: state.attemptId, status: 'in_progress' },
        headers: cors,
      });
      return;
    }
    if (request.method() === 'PATCH' && url.pathname === `/api/listening/tests/attempts/${state.attemptId}/answers`) {
      const patch = { q_num: Number(body?.q_num), user_answer: String(body?.user_answer ?? '') };
      state.patchCalls.push(patch);
      if (patch.user_answer) state.answers.set(patch.q_num, patch.user_answer);
      else state.answers.delete(patch.q_num);
      await route.fulfill({
        json: { attempt_id: state.attemptId, q_num: patch.q_num, answer_count: state.answers.size },
        headers: cors,
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `/api/listening/tests/attempts/${state.attemptId}/submit`) {
      state.submitCalls.push(body || {});
      state.status = 'submitted';
      await route.fulfill({ json: resultPayload(state), headers: cors });
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/auth/me') {
      await route.fulfill({ json: { id: OWNER, display_name: 'Listening fixture' }, headers: cors });
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
  await page.goto(`/listening/test/session?id=${TEST_ID}`);
  await expect(page.getByRole('heading', { name: 'Gate E Listening fixture' })).toBeVisible();
}

async function openLegacy(page) {
  await page.goto(`/pages/listening-test.html?id=${TEST_ID}`);
  await expect(page.locator('#ft-prestart')).toBeVisible();
  await expect(page.locator('#ft-prestart-title')).toContainText('Gate E Listening fixture');
}

async function dispatchAudioMetadata(page) {
  await page.locator('audio').evaluate((audio) => audio.dispatchEvent(new Event('loadedmetadata')));
}

async function expectNoHarnessErrors({ pageErrors, productionRequests }) {
  expect(pageErrors).toEqual([]);
  expect(productionRequests).toEqual([]);
}

module.exports = {
  ATTEMPT,
  TEST_ID,
  cors,
  createListeningGateEState,
  dispatchAudioMetadata,
  expectNoHarnessErrors,
  installListeningGateEHarness,
  openLegacy,
  openNext,
};
