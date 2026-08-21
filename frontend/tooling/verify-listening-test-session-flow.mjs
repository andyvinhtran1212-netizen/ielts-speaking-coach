// Browser-backed contract for the native Listening core-player dark route.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const PRODUCTION_BACKEND = 'https://ielts-speaking-coach-production.up.railway.app';
const FORCE_PRODUCTION_RUNTIME = process.env.VERIFY_PRODUCTION_RUNTIME === '1';
const TEST_ID = 'listening-native-flow';
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111112';
const FAKE_USER_ID = '00000000-0000-0000-0000-000000000038';
const fakeSession = JSON.stringify({
  access_token: 'listening-player-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: FAKE_USER_ID, email: 'listening-player@local' },
});
const testPayload = {
  id: TEST_ID, test_id: 'LIS-NATIVE-01', title: 'Native Listening fixture',
  test_type: 'full', audio_url: 'data:audio/wav;base64,UklGRg==', audio_duration_seconds: 120,
  cue_points: [], sections: [{
    section_num: 1, title: 'Part 1', exercises: [{
      id: 'ex-1', exercise_type: 'dictation',
      payload: {
        template_kind: 'form_completion', instruction: 'Write ONE WORD for each answer.',
        questions: [{ q_num: 1, prompt: 'Meet at ____' }, { q_num: 2, prompt: 'Wear ____' }],
        template: { heading: 'Booking form', rows: [
          { label: 'Place', q_num: 1, prefix: 'Meet at' },
          { label: 'Colour', q_num: 2, prefix: 'Wear' },
        ] },
      },
    }],
  }],
};
const state = {
  status: 'not_started',
  startedAt: '2026-08-11T15:00:00.000Z',
  answers: new Map(),
  rendererAffinity: null,
  starts: 0, claims: 0, patches: [], submits: 0, rejectQ2: true,
};
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const cors = {
  'access-control-allow-origin': BASE,
  'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
};

async function launchChromium() {
  try { return await chromium.launch(); } catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome });
    throw error;
  }
}

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(([key, value]) => {
  try { localStorage.setItem(key, value); } catch (_) {}
  try {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value() { return Promise.resolve(); },
    });
  } catch (_) {}
}, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const pageErrors = [];
const unhandledProductionRequests = [];
let interceptedApiRequests = 0;
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('dialog', async (dialog) => dialog.accept());

await page.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (FORCE_PRODUCTION_RUNTIME && request.method() === 'GET' && url.pathname === '/js/runtime-config.js') {
    return route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.__AVER_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify({
        environment: 'production', apiBase: PRODUCTION_BACKEND,
        supabaseUrl: SB, supabaseAnonKey: null, release: null, gitRef: null,
      })});`,
    });
  }
  if (request.url().startsWith(BASE) || request.url().startsWith('data:')) return route.continue();
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(request.url())) return route.continue();
  // Shared chrome emits read-only page telemetry during boot. Stub the exact
  // endpoint so the fixture remains hermetic; every other production-shaped
  // URL still falls through to the fail-closed branch below.
  if (request.method() === 'POST' && url.pathname === '/api/analytics/events') {
    return route.fulfill({ status: 204, headers: cors });
  }
  if (request.method() === 'GET' && url.pathname === '/auth/me') {
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: FAKE_USER_ID, display_name: 'Listening fixture' }),
      headers: cors,
    });
  }
  if (request.method() === 'GET' && url.pathname === `/api/listening/tests/${TEST_ID}`) {
    interceptedApiRequests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(testPayload), headers: cors });
  }
  if (request.method() === 'GET' && url.pathname === `/api/listening/tests/${TEST_ID}/attempts/in-progress`) {
    interceptedApiRequests += 1;
    const attempt = state.status === 'in_progress' ? {
      attempt_id: ATTEMPT_ID, started_at: state.startedAt,
      renderer_affinity: state.rendererAffinity,
      answers: [...state.answers].map(([q_num, user_answer]) => ({ q_num, user_answer })),
    } : null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ attempt }), headers: cors });
  }
  if (request.method() === 'POST' && url.pathname === `/api/listening/tests/${TEST_ID}/attempts`) {
    interceptedApiRequests += 1;
    state.starts += 1; state.status = 'in_progress'; state.answers.clear(); state.rendererAffinity = null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ attempt_id: ATTEMPT_ID, status: 'in_progress' }), headers: cors });
  }
  if (request.method() === 'POST' && url.pathname === `/api/listening/tests/attempts/${ATTEMPT_ID}/renderer-affinity`) {
    interceptedApiRequests += 1;
    const body = request.postDataJSON();
    state.claims += 1;
    if (state.rendererAffinity === null) state.rendererAffinity = String(body.renderer_affinity || '');
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ attempt_id: ATTEMPT_ID, renderer_affinity: state.rendererAffinity }),
      headers: cors,
    });
  }
  if (request.method() === 'PATCH' && url.pathname === `/api/listening/tests/attempts/${ATTEMPT_ID}/answers`) {
    interceptedApiRequests += 1;
    const body = request.postDataJSON();
    state.patches.push({ q_num: Number(body.q_num), user_answer: String(body.user_answer || '') });
    if (Number(body.q_num) === 2 && state.rejectQ2) {
      return route.fulfill({ status: 422, contentType: 'application/json', body: '{"detail":"fixture rejects q2"}', headers: cors });
    }
    if (body.user_answer) state.answers.set(Number(body.q_num), String(body.user_answer));
    else state.answers.delete(Number(body.q_num));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ attempt_id: ATTEMPT_ID, answer_count: state.answers.size }), headers: cors });
  }
  if (request.method() === 'POST' && url.pathname === `/api/listening/tests/attempts/${ATTEMPT_ID}/submit`) {
    interceptedApiRequests += 1;
    state.submits += 1; state.status = 'submitted';
    const perQuestion = [1, 2].map((q_num) => ({
      q_num, user_answer: state.answers.get(q_num) || '', expected: q_num === 1 ? 'library' : 'blue',
      correct: state.answers.get(q_num) === (q_num === 1 ? 'library' : 'blue'),
    }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      attempt_id: ATTEMPT_ID, score: perQuestion.filter((row) => row.correct).length, max_score: 2,
      band_estimate: 7, section_breakdown: { s1: { correct: 2, total: 2 } },
      trap_analytics: {}, per_question: perQuestion,
    }), headers: cors });
  }
  // CI deliberately builds runtime-config with the production API origin. A
  // canonical fixture request above is still fulfilled locally and therefore
  // never leaves Playwright. Only an UNHANDLED production-shaped request is
  // real egress risk; fail closed and keep its URL for the assertion below.
  if (request.url().startsWith(PRODUCTION_BACKEND)) {
    unhandledProductionRequests.push(request.url());
    return route.abort('blockedbyclient');
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}', headers: cors });
});

await page.goto(`${BASE}/listening/test/session?id=${TEST_ID}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Native Listening fixture' }).waitFor();
check('dark route boots canonical test and prestart', await page.getByRole('button', { name: 'Bắt đầu test' }).isVisible());

await page.getByRole('button', { name: 'Bắt đầu test' }).click();
await page.getByRole('dialog', { name: 'Check your headphones' }).getByRole('button', { name: /Play$/ }).click();
await page.getByLabel('Answer 1').fill('library');
await page.waitForFunction(() => true, null, { timeout: 600 });
await page.waitForTimeout(700);
check(
  'start claims Next once and autosave reaches canonical state',
  state.starts === 1 && state.claims === 1 && state.rendererAffinity === 'next' && state.answers.get(1) === 'library',
);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Tiếp tục bài đang làm' }).click();
await page.getByRole('dialog', { name: 'Check your headphones' }).getByRole('button', { name: /Play$/ }).click();
check('reload resumes the same answer', await page.getByLabel('Answer 1').inputValue() === 'library');

await page.getByLabel('Answer 2').fill('blue');
await page.waitForTimeout(700);
await page.getByText('1 câu chưa lưu được lên máy chủ.').waitFor();
await page.getByRole('button', { name: 'Submit answers' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Nộp bài' }).click();
await page.waitForTimeout(100);
check('terminal partial save blocks finalization', state.submits === 0 && await page.getByText('1 câu chưa lưu được lên máy chủ.').isVisible());

state.rejectQ2 = false;
await page.getByRole('button', { name: 'Thử lại' }).click();
await page.waitForFunction(() => document.querySelectorAll('.ft-unsaved-note').length === 0);
check('manual retry reconciles the missing answer', state.answers.get(2) === 'blue');
await page.getByRole('button', { name: 'Submit answers' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Nộp bài' }).click();
await page.getByRole('heading', { name: 'Kết quả bài thi' }).waitFor();
const scoreText = await page.getByLabel('Tổng quan kết quả').locator('.exam-result-metrics strong').first().textContent();
check('clean submit renders canonical result once', state.submits === 1 && scoreText?.replace(/\s/g, '') === '2/2');
check('no uncaught browser error', pageErrors.length === 0, pageErrors[0] || '');
check(
  'fixture handles APIs with zero production-backend egress',
  interceptedApiRequests > 0 && unhandledProductionRequests.length === 0,
  unhandledProductionRequests[0] || '',
);

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
