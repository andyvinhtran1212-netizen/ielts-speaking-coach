// Fixture-backed browser contract for native `/listening/practice-run`.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const TEST_ID = '11111111-1111-4111-8111-111111111100';
const USER_ID = '00000000-0000-0000-0000-000000000055';
const session = JSON.stringify({
  access_token: 'practice-run-not-a-real-token', refresh_token: 'x', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: USER_ID, email: 'practice-run@local' },
});
const testBundle = {
  id: TEST_ID, test_id: 'PRACTICE-1', test_type: 'practice',
  title: 'Numbers <script>alert(1)</script>',
  audio_url: 'https://audio.test/practice.mp3', audio_duration_seconds: 30,
  sections: [{ section_num: 1, exercises: [{ id: 'exercise-1', content_id: 'content-1', payload: {
    instruction: 'Complete <b>carefully</b>.',
    questions: [
      { q_num: 1, prompt: 'The number is ____.' },
      { q_num: 2, prompt: 'Choose <img src=x>.', options: [
        { letter: 'A', text: 'Blue' }, { letter: 'B', text: '<svg onload=alert(1)>' },
      ] },
    ],
  } }] }],
};
const windowsPayload = { test_id: TEST_ID, windows: {
  1: { start: 3, end: 8 }, 2: { start: 9, end: 14 },
} };
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const cors = {
  'access-control-allow-origin': BASE,
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-request-id',
};
const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

async function authedPage(browser, { viewport = { width: 1280, height: 900 }, windowsFail = false, openAttempt = null } = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, value); } catch (_) {}
  }, [storageKey(SB), session]);
  const page = await context.newPage();
  const errors = [];
  const egress = [];
  const state = {
    startCommitted: Boolean(openAttempt), startPosts: 0, submitPosts: 0,
    attemptId: openAttempt || 'attempt-1', submitted: false, firstAnswers: new Map(), checks: [],
  };
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('dialog', async (dialog) => dialog.dismiss());
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.url().startsWith(BASE)) return route.continue();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(request.url())) return route.continue();
    if (url.hostname === 'audio.test') return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' });
    if (request.method() === 'POST' && ['/api/analytics/events', '/api/error-logs'].includes(url.pathname)) {
      return route.fulfill({ status: 204, headers: cors });
    }
    if (request.method() === 'GET' && url.pathname === '/auth/me') return route.fulfill(json({ id: USER_ID }));
    if (request.method() === 'GET' && url.pathname === `/api/listening/tests/${TEST_ID}`) {
      return route.fulfill(json(testBundle));
    }
    if (request.method() === 'GET' && url.pathname === `/api/listening/tests/${TEST_ID}/practice-windows`) {
      return route.fulfill(windowsFail ? json({ detail: 'fixture unavailable' }, 503) : json(windowsPayload));
    }
    if (request.method() === 'GET' && url.pathname === `/api/listening/tests/${TEST_ID}/attempts/in-progress`) {
      return route.fulfill(json({ attempt: state.startCommitted && !state.submitted ? {
        attempt_id: state.attemptId, started_at: '2026-08-17T00:00:00Z',
        answers: [...state.firstAnswers].map(([q_num, user_answer]) => ({ q_num, user_answer })),
      } : null }));
    }
    if (request.method() === 'POST' && url.pathname === `/api/listening/tests/${TEST_ID}/attempts`) {
      state.startPosts += 1; state.startCommitted = true;
      return route.abort('failed'); // committed, HTTP ACK lost
    }
    const checkMatch = /^\/api\/listening\/tests\/attempts\/([^/]+)\/check$/.exec(url.pathname);
    if (request.method() === 'POST' && checkMatch) {
      const body = request.postDataJSON();
      state.checks.push(body);
      const qNum = Number(body.q_num);
      if (body.reveal) return route.fulfill(json({
        q_num: qNum, correct: false, canonical_correct: false, recorded: false,
        answered_before: true, revealed: true, expected: 'nineteen', alternatives: ['19'],
        solution: { why: 'The speaker corrects the number.' }, audio_window: { start: 3, end: 8 },
      }));
      const answer = String(body.user_answer || '');
      const recorded = !state.firstAnswers.has(qNum);
      if (recorded) state.firstAnswers.set(qNum, answer);
      if (qNum === 1 && state.checks.filter((row) => row.q_num === 1 && !row.reveal).length === 1) {
        return route.abort('failed'); // first answer committed, ACK lost
      }
      const canonical = state.firstAnswers.get(qNum);
      const correct = qNum === 1 ? answer === 'nineteen' : answer === 'A';
      const canonicalCorrect = qNum === 1 ? canonical === 'nineteen' : canonical === 'A';
      return route.fulfill(json({
        q_num: qNum, correct, canonical_correct: canonicalCorrect, recorded,
        answered_before: !recorded, audio_window: qNum === 1 ? { start: 3, end: 8 } : { start: 9, end: 14 },
      }));
    }
    const submitMatch = /^\/api\/listening\/tests\/attempts\/([^/]+)\/submit$/.exec(url.pathname);
    if (request.method() === 'POST' && submitMatch) {
      state.submitPosts += 1; state.submitted = true;
      return route.abort('failed'); // grading persisted, HTTP ACK lost
    }
    if (request.method() === 'GET' && url.pathname === `/api/listening/tests/attempts/${state.attemptId}`) {
      return route.fulfill(json(state.submitted ? {
        attempt_id: state.attemptId, test_id: TEST_ID, status: 'submitted', score: 1,
        grading_details: [
          { q_num: 1, correct: false, user_answer: state.firstAnswers.get(1) || '', expected: 'nineteen' },
          { q_num: 2, correct: true, user_answer: state.firstAnswers.get(2) || '', expected: 'A' },
        ],
      } : { attempt_id: state.attemptId, test_id: TEST_ID, status: 'in_progress' }));
    }
    if (request.url().startsWith('https://ielts-speaking-coach-production.up.railway.app')) {
      egress.push(`${request.method()} ${url.pathname}`); return route.abort('blockedbyclient');
    }
    return route.fulfill(json({}));
  });
  return { context, page, state, errors, egress };
}

const browser = await launch();

const signedOut = await browser.newContext({ viewport: { width: 375, height: 812 } });
const signedOutPage = await signedOut.newPage();
await signedOutPage.goto(`${BASE}/listening/practice-run?id=${TEST_ID}`, { waitUntil: 'domcontentloaded' });
await signedOutPage.waitForURL('**/login');
check('signed-out route fails closed to native login', new URL(signedOutPage.url()).pathname === '/login');
await signedOut.close();

const run = await authedPage(browser);
await run.page.goto(`${BASE}/listening/practice-run?id=${TEST_ID}`, { waitUntil: 'domcontentloaded' });
await run.page.getByRole('heading', { name: /Numbers <script>alert\(1\)<\/script>/ }).waitFor();
check('start ACK loss is reconciled by GET without a destructive replay', run.state.startPosts === 1);
check('authored markup renders as text', await run.page.locator('main script, .lpr-next-question img, .lpr-next-question svg').count() === 0);
await run.page.getByLabel('Câu trả lời câu 1').fill('ninety');
await run.page.getByRole('button', { name: 'Kiểm tra' }).click();
await run.page.getByRole('button', { name: 'Thử chấm lại đúng câu trả lời này' }).waitFor();
await run.page.getByRole('button', { name: 'Thử chấm lại đúng câu trả lời này' }).click();
await run.page.getByText('Chưa đúng.', { exact: true }).waitFor();
check('lost check ACK retries the exact first answer',
  run.state.checks[0]?.user_answer === 'ninety' && run.state.checks[1]?.user_answer === 'ninety');
check('miss arms the server-returned audio loop', await run.page.locator('audio-player[auto-loop="true"][segment-start="3"]').count() === 1);
await run.page.getByLabel('Câu trả lời câu 1').fill('eighteen');
await run.page.getByRole('button', { name: 'Kiểm tra' }).click();
await run.page.getByRole('button', { name: 'Xem đáp án' }).click();
await run.page.getByText('Đáp án: nineteen').waitFor();
check('reveal is available only after two confirmed misses and keeps alternatives/explanation',
  await run.page.getByText('Cũng chấp nhận: 19').isVisible()
    && await run.page.getByText('The speaker corrects the number.').isVisible());
await run.page.getByRole('button', { name: 'Câu tiếp theo →' }).click();
await run.page.getByText('Choose <img src=x>.').waitFor();
await run.page.locator('.lpr-next-options label').first().click();
await run.page.getByRole('button', { name: 'Kiểm tra' }).click();
await run.page.getByText('Chính xác.').waitFor();
await run.page.getByRole('button', { name: 'Xem tổng kết →' }).click();
await run.page.getByText('1 / 2', { exact: true }).waitFor();
check('submit ACK loss reconciles owner attempt and never resubmits', run.state.submitPosts === 1);
check('summary preserves canonical first-answer score',
  run.state.firstAnswers.get(1) === 'ninety' && run.state.firstAnswers.get(2) === 'A'
    && await run.page.getByText(/Điểm chỉ dùng câu trả lời đầu tiên/).isVisible());
check('main flow has no production egress or browser error', run.egress.length === 0 && run.errors.length === 0, run.egress[0] || run.errors[0] || '');
await run.context.close();

const mobile = await authedPage(browser, {
  viewport: { width: 375, height: 812 }, windowsFail: true, openAttempt: 'attempt-mobile',
});
await mobile.page.goto(`${BASE}/listening/practice-run?id=${TEST_ID}`, { waitUntil: 'domcontentloaded' });
await mobile.page.getByText(/vẫn có thể luyện bằng toàn bộ audio/).waitFor();
check('optional practice-window failure degrades to whole audio without starting over', mobile.state.startPosts === 0);
check('mobile workspace stays inside the viewport', await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
check('mobile fallback has no production egress or browser error', mobile.egress.length === 0 && mobile.errors.length === 0, mobile.egress[0] || mobile.errors[0] || '');
await mobile.context.close();

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
