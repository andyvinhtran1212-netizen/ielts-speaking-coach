// Fixture-backed browser contract for native `/mock-exam`.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const USER_ID = '00000000-0000-4000-8000-000000000088';
const SITTING_ID = '22222222-2222-4222-8222-222222222222';
const CODE = 'MOCK-NATIVE-1';
const session = JSON.stringify({
  access_token: 'mock-exam-not-a-real-token', refresh_token: 'x', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: USER_ID, email: 'mock-exam@local' },
});
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
const json = (body, status = 200) => ({
  status, contentType: 'application/json', headers: cors, body: JSON.stringify(body),
});

function mockState(overrides = {}) {
  const state = {
    sitting: {
      id: SITTING_ID, mock_exam_id: 'exam-1', user_id: USER_ID, status: 'registered', sealed: true,
      listening_attempt_id: null, reading_attempt_id: null,
      listening_submitted_at: null, reading_submitted_at: null, writing_submitted_at: null,
      writing_submission: {
        task1: { text: 'Server draft', submitted_at: '2026-08-16T00:00:00Z' },
        task2: { text: '', submitted_at: null },
      },
    },
    exam: {
      listening_test_id: 'listen-1', reading_test_code: 'READ-1', reading_title: 'Mock <script>alert(1)</script>',
      writing_task1: { id: 'w1', task_type: 'task1', title: 'Chart', prompt_text: 'Describe <b>the chart</b>.', prompt_image_url: null },
      writing_task2: { id: 'w2', task_type: 'task2', title: 'Essay', prompt_text: 'Discuss both views.', prompt_image_url: null },
      speaking_topic_set: { part1: ['Work'] }, total_minutes: 150,
      reading_minutes: 60, writing_minutes: 60, review_sla_days: 3,
    },
    exam_mode: 'sequential', assigned_skills: null,
    active_section: 'not_started', collected_section: null,
    section_time_left_seconds: null, section_duration_seconds: null,
  };
  return Object.assign(state, overrides);
}

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

async function fixturePage(browser, initialState, {
  drafts = {}, createLostAck = false, finalWritingLostAck = false,
  finalWritingAlwaysFails = false, writingDraftAlwaysFails = false, fakeClock = false,
  finalWritingCollectPause = false, deferStateGet = null, deferEmbedSave = false,
} = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(([key, value, sittingId, seededDrafts]) => {
    try {
      localStorage.setItem(key, value);
      for (const [task, draft] of Object.entries(seededDrafts)) {
        localStorage.setItem(`mock-writing:${sittingId}:${task}`, JSON.stringify(draft));
      }
    } catch (_) {}
  }, [storageKey(SB), session, SITTING_ID, drafts]);
  const page = await context.newPage();
  if (fakeClock) await page.clock.install({ time: new Date() });
  const errors = [];
  const egress = [];
  const calls = [];
  const state = {
    current: structuredClone(initialState), creates: 0, stateGets: 0,
    writingDrafts: [], writingFinals: [],
  };
  let markDeferredReady;
  let markDeferredDelivered;
  let markEmbedSaveReady;
  let markEmbedSavePersisted;
  state.deferredReady = new Promise((resolve) => { markDeferredReady = resolve; });
  state.deferredDelivered = new Promise((resolve) => { markDeferredDelivered = resolve; });
  state.embedSaveReady = new Promise((resolve) => { markEmbedSaveReady = resolve; });
  state.embedSavePersisted = new Promise((resolve) => { markEmbedSavePersisted = resolve; });
  state.embedAnswerBodies = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('dialog', async (dialog) => dialog.dismiss());
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === BASE && url.pathname === '/core-player/launch') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: deferEmbedSave
          ? `<script>window.embedReady=true;addEventListener('message',async e=>{if(e.origin===location.origin&&e.data&&e.data.type==='mock-flush'){await fetch('/__mock-answer',{method:'PATCH',body:'latest-answer'});parent.postMessage({type:'mock-flushed',section:'listening',unsaved:0},location.origin)}})<\/script>`
          : `<script>window.embedReady=true;addEventListener('message',e=>{if(e.origin===location.origin&&e.data&&e.data.type==='mock-flush')parent.postMessage({type:'mock-flushed',section:'listening',unsaved:0},location.origin)})<\/script>`,
      });
    }
    if (deferEmbedSave && url.origin === BASE && url.pathname === '/__mock-answer'
        && request.method() === 'PATCH') {
      state.embedAnswerBodies.push(request.postData());
      await new Promise((resolve) => {
        state.releaseEmbedSave = resolve;
        markEmbedSaveReady();
      });
      await route.fulfill(json({ ok: true }));
      markEmbedSavePersisted();
      return;
    }
    if (request.url().startsWith(BASE)) return route.continue();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(request.url())) return route.continue();
    if (request.method() === 'POST' && ['/api/analytics/events', '/api/error-logs'].includes(url.pathname)) {
      return route.fulfill({ status: 204, headers: cors });
    }
    if (request.method() === 'GET' && url.pathname === '/auth/me') return route.fulfill(json({ id: USER_ID }));
    if (request.method() === 'POST' && url.pathname === `/api/mock-exams/${CODE}/sittings`) {
      state.creates += 1;
      if (createLostAck && state.creates === 1) return route.abort('failed');
      return route.fulfill(json({ id: SITTING_ID, created: false }));
    }
    if (request.method() === 'GET' && url.pathname === `/api/mock-exams/sittings/${SITTING_ID}`) {
      state.stateGets += 1;
      if (state.stateGets === deferStateGet) {
        const snapshot = structuredClone(state.current);
        await new Promise((resolve) => {
          state.releaseDeferredState = resolve;
          markDeferredReady();
        });
        await route.fulfill(json(snapshot));
        markDeferredDelivered();
        return;
      }
      return route.fulfill(json(state.current));
    }
    if (request.method() === 'POST' && url.pathname === `/api/mock-exams/sittings/${SITTING_ID}/integrity`) {
      return route.fulfill(json({ ok: true }));
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/sections/writing/start')) {
      calls.push('start-writing');
      state.current.active_section = 'writing';
      state.current.section_time_left_seconds = 600;
      state.current.section_duration_seconds = 600;
      return route.fulfill(json({ ok: true }));
    }
    if (request.method() === 'POST' && url.pathname === `/api/mock-exams/sittings/${SITTING_ID}/writing`) {
      state.writingDrafts.push(request.postDataJSON());
      if (writingDraftAlwaysFails || state.current.sitting.writing_submitted_at) {
        return route.fulfill(json({ detail: 'writing already collected' }, 409));
      }
      return route.fulfill(json({ ok: true }));
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/sections/writing/submit')) {
      const body = request.postDataJSON();
      state.writingFinals.push(body);
      if (finalWritingCollectPause && state.writingFinals.length === 1) {
        state.current.collected_section = 'writing';
        state.current.section_time_left_seconds = 0;
        return route.fulfill(json({ detail: 'temporary failure during collection' }, 503));
      }
      if (finalWritingCollectPause) {
        state.current.sitting.writing_submission = {
          task1: { text: body.task1_text, submitted_at: '2026-08-17T02:00:00Z' },
          task2: { text: body.task2_text, submitted_at: '2026-08-17T02:00:00Z' },
        };
        state.current.sitting.writing_submitted_at = '2026-08-17T02:00:00Z';
        state.current.sitting.status = 'lrw_submitted';
        state.current.active_section = 'done';
        return route.fulfill(json({ ok: true }));
      }
      if (finalWritingAlwaysFails) return route.fulfill(json({ detail: 'temporary failure' }, 503));
      if (finalWritingLostAck && state.writingFinals.length === 1) {
        state.current.sitting.writing_submitted_at = '2026-08-17T02:00:00Z';
        state.current.sitting.writing_submission = {
          task1: { text: body.task1_text, submitted_at: '2026-08-17T02:00:00Z' },
          task2: { text: body.task2_text, submitted_at: '2026-08-17T02:00:00Z' },
        };
        state.current.sitting.status = 'lrw_submitted';
        state.current.active_section = 'done';
        state.current.section_time_left_seconds = 0;
        return route.abort('failed');
      }
      if (finalWritingLostAck) return route.fulfill(json({ detail: 'already submitted' }, 409));
      return route.fulfill(json({ ok: true }));
    }
    if (request.method() === 'POST' && url.pathname === '/api/listening/tests/attempts/listening-attempt-1/submit') {
      calls.push('domain-listening');
      return route.fulfill(json({ received: true }));
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/sections/listening/submit')) {
      calls.push('stamp-listening');
      state.current.sitting.listening_submitted_at = '2026-08-17T02:00:00Z';
      state.current.active_section = 'listening';
      state.current.collected_section = 'listening';
      state.current.section_time_left_seconds = 0;
      return route.fulfill(json({ ok: true }));
    }
    if (request.url().startsWith('https://ielts-speaking-coach-production.up.railway.app')) {
      egress.push(`${request.method()} ${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    return route.fulfill(json({}));
  });
  return { context, page, state, calls, errors, egress };
}

const browser = await launch();

const signedOut = await browser.newContext({ viewport: { width: 375, height: 812 } });
const signedOutPage = await signedOut.newPage();
await signedOutPage.goto(`${BASE}/mock-exam?sitting=${SITTING_ID}`, { waitUntil: 'domcontentloaded' });
await signedOutPage.waitForURL('**/login');
check('signed-out runner fails closed to native login', new URL(signedOutPage.url()).pathname === '/login');
await signedOut.close();

const waiting = await fixturePage(browser, mockState(), { createLostAck: true });
await waiting.page.goto(`${BASE}/mock-exam?code=${CODE}`, { waitUntil: 'domcontentloaded' });
await waiting.page.getByRole('heading', { name: /Thi thử: Mock <script>alert\(1\)<\/script>/ }).waitFor();
check('lost create ACK retries the idempotent open-sitting endpoint', waiting.state.creates === 2 && waiting.state.stateGets >= 1);
check('sequential sitting stays in the invigilator-controlled waiting room',
  await waiting.page.getByText(/Đang chờ giám thị bắt đầu/).isVisible()
    && await waiting.page.getByRole('button', { name: /Bắt đầu/ }).count() === 0);
check('authored mock title renders as text', await waiting.page.locator('main script').count() === 0);
await waiting.context.close();

const retakeState = mockState({
  exam_mode: 'retake', assigned_skills: ['writing'], active_section: 'not_started',
});
const retake = await fixturePage(browser, retakeState);
await retake.page.goto(`${BASE}/mock-exam?sitting=${SITTING_ID}`, { waitUntil: 'domcontentloaded' });
await retake.page.getByRole('button', { name: /Bắt đầu.*Writing/ }).click();
await retake.page.getByLabel('Bài viết Task 1').waitFor();
check('retake starts only an explicitly assigned section',
  retake.calls.join(',') === 'start-writing'
    && await retake.page.getByRole('button', { name: /Listening|Reading/ }).count() === 0);
await retake.context.close();

const staleReadState = mockState({
  exam_mode: 'retake', assigned_skills: ['writing'], active_section: 'not_started',
});
const staleRead = await fixturePage(browser, staleReadState, { deferStateGet: 2, fakeClock: true });
await staleRead.page.goto(`${BASE}/mock-exam?sitting=${SITTING_ID}`, { waitUntil: 'domcontentloaded' });
await staleRead.page.getByRole('button', { name: /Bắt đầu.*Writing/ }).waitFor();
await staleRead.page.clock.runFor(8_001);
await staleRead.state.deferredReady;
await staleRead.page.getByRole('button', { name: /Bắt đầu.*Writing/ }).click();
await staleRead.page.getByLabel('Bài viết Task 1').waitFor();
staleRead.state.releaseDeferredState();
await staleRead.state.deferredDelivered;
await new Promise((resolve) => setTimeout(resolve, 50));
check('a stale poll response cannot overwrite newer post-action sitting state',
  await staleRead.page.getByLabel('Bài viết Task 1').isVisible()
    && await staleRead.page.getByRole('button', { name: /Bắt đầu.*Writing/ }).count() === 0);
await staleRead.context.close();

const listeningState = mockState({
  active_section: 'listening', section_time_left_seconds: 1, section_duration_seconds: 60,
});
listeningState.sitting.listening_attempt_id = 'listening-attempt-1';
const listening = await fixturePage(browser, listeningState);
await listening.page.goto(`${BASE}/mock-exam?sitting=${SITTING_ID}`, { waitUntil: 'domcontentloaded' });
const frame = listening.page.locator('iframe');
await frame.waitFor();
const listeningFrameSrc = await frame.getAttribute('src');
await listening.page.getByText(/Đã nộp phần trước/).waitFor({ timeout: 8_000 });
check('embedded Listening uses stable core admission and flushes before finalization',
  listeningFrameSrc?.startsWith('/core-player/launch?')
    && listening.calls.join(',') === 'domain-listening,stamp-listening', listening.calls.join(','));
await listening.context.close();

const collectedListeningState = mockState({
  active_section: 'listening', section_time_left_seconds: 600, section_duration_seconds: 600,
});
collectedListeningState.sitting.listening_attempt_id = 'listening-attempt-1';
const collectedListening = await fixturePage(browser, collectedListeningState, { deferEmbedSave: true });
await collectedListening.page.goto(`${BASE}/mock-exam?sitting=${SITTING_ID}`, { waitUntil: 'domcontentloaded' });
const collectedFrame = collectedListening.page.locator('iframe');
await collectedFrame.waitFor();
await collectedFrame.contentFrame().locator('body').waitFor();
collectedListening.state.current.collected_section = 'listening';
await collectedListening.page.evaluate(() => window.dispatchEvent(new Event('online')));
await collectedListening.state.embedSaveReady;
check('collection keeps the embedded paper mounted while its final answer PATCH is pending',
  await collectedFrame.count() === 1
    && await collectedListening.page.getByText(/Đang lưu câu trả lời cuối cùng/).isVisible());
collectedListening.state.releaseEmbedSave();
await collectedListening.state.embedSavePersisted;
await collectedListening.page.getByText(/Đã nộp phần trước/).waitFor();
check('collection unmounts the paper only after the flush ACK persisted the latest answer',
  collectedListening.state.embedAnswerBodies.join(',') === 'latest-answer'
    && await collectedFrame.count() === 0);
await collectedListening.context.close();

const writingState = mockState({
  active_section: 'writing', section_time_left_seconds: 1, section_duration_seconds: 60,
});
const localTask1 = 'Local unsynced Task 1 survives reload.';
const localTask2 = 'Local unsynced Task 2 survives reload.';
const writing = await fixturePage(browser, writingState, {
  finalWritingLostAck: true,
  drafts: {
    task1: { text: localTask1, ts: Date.now() + 10_000, synced: false },
    task2: { text: localTask2, ts: Date.now() + 10_000, synced: false },
  },
});
await writing.page.goto(`${BASE}/mock-exam?sitting=${SITTING_ID}`, { waitUntil: 'domcontentloaded' });
await writing.page.getByRole('heading', { name: 'Đã thu bài' }).waitFor({ timeout: 10_000 });
const localDrafts = await writing.page.evaluate((id) => [
  localStorage.getItem(`mock-writing:${id}:task1`),
  localStorage.getItem(`mock-writing:${id}:task2`),
], SITTING_ID);
check('unsynced local Writing drafts win restore and autosave before collection',
  writing.state.writingDrafts.some((body) => body.task1_text === localTask1 && body.task2_text === localTask2));
check('lost final ACK reuses one immutable Writing payload and reconciles canonical state',
  writing.state.writingFinals.length === 2
    && JSON.stringify(writing.state.writingFinals[0]) === JSON.stringify(writing.state.writingFinals[1])
    && writing.state.writingFinals[0].task1_text === localTask1
    && localDrafts.every((value) => value === null));

const forceCollectedState = mockState({
  active_section: 'writing', section_time_left_seconds: 600, section_duration_seconds: 600,
});
const forceCollectedDraft = 'Newer local text inside the debounce window.';
const forceCollected = await fixturePage(browser, forceCollectedState, {
  fakeClock: true,
  writingDraftAlwaysFails: true,
  drafts: {
    task1: { text: forceCollectedDraft, ts: Date.now() + 10_000, synced: false },
  },
});
await forceCollected.page.goto(`${BASE}/mock-exam?sitting=${SITTING_ID}`, { waitUntil: 'domcontentloaded' });
await forceCollected.page.getByLabel('Bài viết Task 1').waitFor();
forceCollected.state.current.sitting.writing_submitted_at = '2026-08-17T02:00:00Z';
forceCollected.state.current.sitting.status = 'lrw_submitted';
forceCollected.state.current.active_section = 'done';
forceCollected.state.current.section_time_left_seconds = 0;
await forceCollected.page.clock.runFor(8_001);
await forceCollected.page.getByRole('heading', { name: 'Đã thu bài' }).waitFor();
await forceCollected.page.goto(`${BASE}/next-probe`, { waitUntil: 'domcontentloaded' });
const forceCollectedLocal = await forceCollected.page.evaluate((id) => (
  localStorage.getItem(`mock-writing:${id}:task1`)
), SITTING_ID);
check('admin collection preserves a newer unsynced Writing draft through poll and unmount',
  JSON.parse(forceCollectedLocal || '{}').text === forceCollectedDraft
    && JSON.parse(forceCollectedLocal || '{}').synced === false);
await forceCollected.context.close();

const pausedRetryTask1 = 'Task 1 must survive collection retry.';
const pausedRetryTask2 = 'Task 2 must also survive collection retry.';
const pausedRetry = await fixturePage(browser, mockState({
  active_section: 'writing', section_time_left_seconds: 0, section_duration_seconds: 60,
}), {
  fakeClock: true,
  finalWritingCollectPause: true,
  drafts: {
    task1: { text: pausedRetryTask1, ts: Date.now() + 10_000, synced: false },
    task2: { text: pausedRetryTask2, ts: Date.now() + 10_000, synced: false },
  },
});
await pausedRetry.page.goto(`${BASE}/mock-exam?sitting=${SITTING_ID}`, { waitUntil: 'domcontentloaded' });
const pausedRetryDeadline = Date.now() + 3_000;
while (pausedRetry.state.writingFinals.length < 1 && Date.now() < pausedRetryDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
await pausedRetry.page.evaluate(() => window.dispatchEvent(new Event('online')));
await pausedRetry.page.getByText(/Đã nộp phần trước/).waitFor();
await pausedRetry.page.clock.runFor(2_001);
await pausedRetry.page.getByRole('heading', { name: 'Đã thu bài' }).waitFor();
check('Writing retry retains the immutable final payload after collect closes the workspace',
  pausedRetry.state.writingFinals.length === 2
    && JSON.stringify(pausedRetry.state.writingFinals[0]) === JSON.stringify(pausedRetry.state.writingFinals[1])
    && pausedRetry.state.writingFinals[1].task1_text === pausedRetryTask1
    && pausedRetry.state.writingFinals[1].task2_text === pausedRetryTask2);
await pausedRetry.context.close();

const boundedFailure = await fixturePage(browser, mockState({
  active_section: 'writing', section_time_left_seconds: 0, section_duration_seconds: 60,
}), { finalWritingAlwaysFails: true, fakeClock: true });
await boundedFailure.page.goto(`${BASE}/mock-exam?sitting=${SITTING_ID}`, { waitUntil: 'domcontentloaded' });
const waitForWritingAttempts = async (count) => {
  const deadline = Date.now() + 3_000;
  while (boundedFailure.state.writingFinals.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
await waitForWritingAttempts(1);
for (const [index, delay] of [2_000, 5_000, 10_000, 20_000].entries()) {
  await boundedFailure.page.clock.runFor(delay + 1);
  await waitForWritingAttempts(index + 2);
}
await boundedFailure.page.getByText(/Chưa nộp được lên máy chủ/).waitFor();
// Cover three 500 ms countdown ticks while remaining below the next 3 s
// canonical-state poll. Polling and `online` are deliberate recovery signals;
// the countdown itself must not start another retry ladder.
await boundedFailure.page.clock.runFor(1_500);
await new Promise((resolve) => setTimeout(resolve, 50));
const attemptsAfterExhaustion = boundedFailure.state.writingFinals.length;
check('permanent submit failure stops after one bounded retry ladder', attemptsAfterExhaustion === 5,
  String(attemptsAfterExhaustion));
await boundedFailure.page.evaluate(() => window.dispatchEvent(new Event('online')));
await waitForWritingAttempts(6);
check('explicit online recovery may start one new submit attempt',
  boundedFailure.state.writingFinals.length === 6, String(boundedFailure.state.writingFinals.length));
check('fixture flows have no production egress or browser error',
  [waiting, retake, staleRead, listening, collectedListening, writing, forceCollected, pausedRetry, boundedFailure]
    .every((run) => run.egress.length === 0 && run.errors.length === 0),
  [...waiting.egress, ...retake.egress, ...staleRead.egress, ...listening.egress, ...collectedListening.egress, ...writing.egress,
    ...forceCollected.egress, ...pausedRetry.egress, ...boundedFailure.egress, ...waiting.errors, ...retake.errors,
    ...staleRead.errors, ...listening.errors, ...collectedListening.errors, ...writing.errors, ...forceCollected.errors,
    ...pausedRetry.errors, ...boundedFailure.errors][0] || '');
await boundedFailure.context.close();
await writing.context.close();

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
