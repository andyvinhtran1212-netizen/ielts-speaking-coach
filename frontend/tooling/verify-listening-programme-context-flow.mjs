// Actual Next lifecycle with synthetic API state. Never point this at a live site.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const origin = new URL(BASE);
assert.ok(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname), 'Loopback Next required');
const SB = 'https://example.supabase.co';
const userId = '00000000-0000-0000-0000-000000000901';
const lessonId = '00000000-0000-0000-0000-000000000902';
const testId = '00000000-0000-0000-0000-000000000903';
const attemptId = '00000000-0000-0000-0000-000000000904';
const session = JSON.stringify({ access_token: 'context-lifecycle-not-real', refresh_token: 'x', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: userId, email: 'lifecycle@local' } });
let checks = 0;
const check = (name, condition) => { assert.ok(condition, name); checks += 1; console.log(`✓ ${name}`); };
// EXAMLISTENP-0069 T003: the same journey runs with the exam room off (current runner)
// and on (`examRoomSurfaces: ['listening-practice']`). Only the steps that differ branch.
const ROOM_MODES = (process.env.LISTENING_EXAM_ROOM || 'off,on').split(',').map((v) => v.trim()).filter(Boolean);
assert.ok(ROOM_MODES.length && ROOM_MODES.every((v) => v === 'off' || v === 'on'), 'LISTENING_EXAM_ROOM is off, on or off,on');
/** The room's submit box asks once more; the current runner submits at once. */
async function clickIfPresent(locator) {
  if (await locator.count()) { await locator.click(); return true; }
  return false;
}
async function waitForFinalAnswer(promise, label) {
  let timer;
  try {
    await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: final answer PATCH did not start within 15s`)), 15_000);
    })]);
  } finally { clearTimeout(timer); }
}
let browser;
try { browser = await chromium.launch(); } catch (error) {
  const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform !== 'darwin' || !existsSync(executablePath)) throw error;
  browser = await chromium.launch({ executablePath });
}
try {
  for (const roomMode of ROOM_MODES) for (const path of ['general', 'ielts']) for (const filter of ['new', 'in_progress', 'completed']) {
    const room = roomMode === 'on';
    const tag = `${room ? 'room ' : ''}${path}/${filter}`;
    const programmeId = `${path}-listening-practice`;
    const context = await browser.newContext({ viewport: { width: path === 'general' ? 390 : 1440, height: 900 } });
    await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
    const requests = []; const errors = []; const unexpected = [];
    let completed = filter === 'completed'; let admitted = filter === 'in_progress'; let answer = '';
    let releaseAnswer; let announceAnswer;
    const finalAnswerStarted = new Promise((resolve) => { announceAnswer = resolve; });
    const count = (method, suffix) => requests.filter((r) => r.method === method && r.path.endsWith(suffix)).length;
    const writes = () => requests.filter((r) => !['GET', 'HEAD', 'OPTIONS'].includes(r.method) && !['/api/analytics/events', '/api/error-logs'].includes(r.path));
    await context.route('**/*', async (route) => {
      const req = route.request(); const url = new URL(req.url()); const method = req.method(); const p = url.pathname;
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.origin === origin.origin && p === '/js/runtime-config.js') return route.fulfill({ contentType: 'application/javascript', body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze(${JSON.stringify({ environment: 'test', apiBase: 'https://learning-context-fixture.invalid', supabaseUrl: SB, supabaseAnonKey: 'synthetic-key', ...(room ? { examRoomSurfaces: ['listening-practice'] } : {}) })});` });
      if (url.origin === origin.origin || ['data:', 'about:'].includes(url.protocol)) return route.continue();
      const body = ['POST', 'PATCH'].includes(method) ? req.postDataJSON() : undefined;
      requests.push({ method, path: p, search: url.search, body });
      if (p === '/auth/me') return json({ id: userId, role: 'student', email: 'lifecycle@local' });
      if (p === `/api/listening/programmes/${programmeId}/lessons` && method === 'GET') return json({ items: [
        { id: lessonId, title: 'Lifecycle lesson', sequence_num: 1, form_count: 1, completed_form_count: completed ? 1 : 0, in_progress_form_count: !completed && admitted ? 1 : 0 },
        { id: 'other-lesson', title: 'Other lesson', sequence_num: 2, form_count: 1, completed_form_count: filter === 'completed' ? 1 : 0, in_progress_form_count: filter === 'in_progress' ? 1 : 0 },
      ] });
      if (p === `/api/listening/lessons/${lessonId}` && method === 'GET') return json({ programme_id: programmeId, title: 'Lifecycle lesson', forms: [{ id: testId, title: 'Lifecycle form', status: completed ? 'completed' : admitted ? 'in_progress' : 'new', attempt_id: completed ? attemptId : null, item_count: 1 }] });
      if (p === `/api/listening/tests/${testId}/attempts` && method === 'POST') {
        assert.equal(url.search, '?standalone=true'); assert.deepEqual(body, {}); admitted = true;
        return json({ attempt_id: attemptId, answers: answer ? [{ q_num: 1, user_answer: answer }] : [] });
      }
      if (p === `/api/listening/tests/${testId}` && method === 'GET') {
        assert.equal(url.search, `?attempt_id=${attemptId}`);
        return json({ programme_id: programmeId, listening_lesson_id: lessonId, scoring_policy: 'report_only', title: 'Lifecycle form', replay_policy: 'allowed', sections: [{ exercises: [{ payload: { variant: 'programme_form_v1', questions: [{ q_num: 1, source_item_id: 'source-1', prompt: 'Which place?', response_type: 'single_choice', options: { A: 'Library', B: 'Museum' } }] } }] }] });
      }
      if (p === `/api/listening/tests/attempts/${attemptId}/guided-state` && method === 'GET') return json({ attempt_id: attemptId, assisted: false, items: [] });
      if (p === `/api/listening/tests/attempts/${attemptId}/answers` && method === 'PATCH') {
        assert.deepEqual(body, { q_num: 1, user_answer: 'A' });
        if (count('PATCH', '/answers') === 2) { announceAnswer(); await new Promise((resolve) => { releaseAnswer = resolve; }); }
        answer = body.user_answer; return json({});
      }
      if (p === `/api/listening/tests/attempts/${attemptId}/submit` && method === 'POST') {
        assert.deepEqual(body, {}); assert.equal(answer, 'A'); completed = true; return json({});
      }
      if (p === `/api/listening/tests/attempts/${attemptId}/review` && method === 'GET') return completed ? json({ programme_id: programmeId, listening_lesson_id: lessonId, scoring_policy: 'report_only', title: 'Lifecycle result', result_summary: { item_count: 1, completion_count: 1, checked_count: 1, correct_count: 1 }, review: [{ q_num: 1, state: 'checked', correct: true, user_answer: answer || 'A', expected: ['A'], prompt: 'Which place?' }] }) : json({ detail: 'not submitted' }, 403);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !['/api/analytics/events', '/api/error-logs'].includes(p)) unexpected.push(`${method} ${p}`);
      return json({});
    });
    const page = await context.newPage(); page.on('pageerror', (error) => errors.push(String(error)));
    const formPath = `/listening/programmes/form/${testId}`;
    const resultPath = `/listening/programmes/result/${attemptId}`;
    const query = `?from=${path}&filter=${filter}`;
    const library = `/listening/${path}?filter=${filter}`;
    const lesson = `/listening/${path}/${lessonId}${query}`;
    // The room shows the form title in the shell's top bar, not as a heading.
    const formReady = async () => {
      if (!room) { await page.getByRole('heading', { name: 'Lifecycle form', exact: true }).waitFor(); return; }
      await page.locator('[data-exam-room]').waitFor();
      await page.getByText('Lifecycle form', { exact: true }).first().waitFor();
      // FR-012: inputs stay locked until this tab holds the write lock.
      await page.waitForFunction(() => { const input = document.querySelector('[data-exam-room] input[type="radio"]'); return input && !input.disabled; });
    };
    const backToLesson = () => (room ? page.getByRole('button', { name: 'Thoát' }) : page.getByRole('link', { name: /Bài học/ }));
    const backTargetsLesson = async () => (room ? await backToLesson().count() === 1 : await backToLesson().getAttribute('href') === lesson);
    const mountId = () => page.locator('.programme-runner').evaluate((node) => node.dataset.fixtureMount ||= crypto.randomUUID());
    try {
      await page.goto(BASE + library); await page.getByRole('heading', { name: 'Lifecycle lesson', exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Lifecycle lesson', exact: true }).click(); await page.getByRole('heading', { name: 'Chọn bài nghe' }).waitFor();
      check(`${tag} library→lesson context`, new URL(page.url()).pathname + new URL(page.url()).search === lesson && await page.getByRole('link', { name: /Thư viện chương trình/ }).getAttribute('href') === library);
      if (!completed) {
        const start = page.getByRole('link', { name: filter === 'new' ? /Bắt đầu/ : /Tiếp tục/ });
        check(`${tag} start/resume href`, await start.getAttribute('href') === formPath + query);
        await start.click(); await formReady();
        check(`${tag} admission exact once, Back canonical lesson, feedback private`, count('POST', '/attempts') === 1 && await backTargetsLesson() && await page.locator('.programme-question-feedback').count() === 0);
        await page.reload(); await formReady(); const beforeHistoryMount = await mountId();
        check(`${tag} reload retains context and admits once`, count('POST', '/attempts') === 2 && new URL(page.url()).search === query);
        await page.getByRole('radio', { name: /Library/ }).focus(); await page.keyboard.press('Space'); await page.getByText('Đã lưu', { exact: false }).waitFor();
        check(`${tag} exact autosave`, count('PATCH', '/answers') === 1);
        await page.goBack(); await page.getByRole('heading', { name: 'Chọn bài nghe' }).waitFor();
        check(`${tag} native Back retains context`, new URL(page.url()).pathname + new URL(page.url()).search === lesson);
        const admissionsBeforeForward = count('POST', '/attempts');
        await page.goForward(); await formReady();
        const retained = await mountId() === beforeHistoryMount;
        check(`${tag} native Forward restores saved answer and exact mount admission`, await page.getByRole('radio', { name: /Library/ }).isChecked() && new URL(page.url()).search === query && count('POST', '/attempts') === admissionsBeforeForward + (retained ? 0 : 1));
        await backToLesson().click(); await page.getByRole('heading', { name: 'Chọn bài nghe' }).waitFor();
        check(`${tag} explicit form→lesson Back retains context`, new URL(page.url()).pathname + new URL(page.url()).search === lesson);
        const beforeResume = count('POST', '/attempts'); await page.getByRole('link', { name: /Tiếp tục/ }).click(); await formReady();
        check(`${tag} resume restores canonical saved answer`, count('POST', '/attempts') === beforeResume + 1 && await page.getByRole('radio', { name: /Library/ }).isChecked());
        await page.getByRole('button', { name: 'Hoàn thành và xem lại' }).first().click();
        const confirmed = await clickIfPresent(page.getByRole('alertdialog').getByRole('button', { name: 'Hoàn thành và xem lại' }));
        check(`${tag} submit box only in the room`, confirmed === room);
        await waitForFinalAnswer(finalAnswerStarted, tag);
        const busy = room ? page.getByRole('alertdialog').getByRole('button', { name: /Đang nộp/ }) : page.getByRole('button', { name: 'Đang hoàn thành…' });
        check(`${tag} submit waits for exact answer ACK`, count('POST', '/submit') === 0 && await busy.isDisabled());
        releaseAnswer(); await page.waitForURL((url) => url.pathname === resultPath); await page.getByRole('heading', { name: 'Lifecycle result' }).waitFor();
        check(`${tag} submit→result retains context, exact final PATCH and submit`, new URL(page.url()).search === query && count('PATCH', '/answers') === 2 && count('POST', '/submit') === 1);
      } else {
        const review = page.getByRole('link', { name: /Xem lại/ }); check(`${tag} Xem lại carries context`, await review.getAttribute('href') === resultPath + query);
        await review.click(); await page.getByRole('heading', { name: 'Lifecycle result' }).waitFor();
      }
      const afterSubmitWrites = writes().length;
      await page.reload(); await page.getByRole('heading', { name: 'Lifecycle result' }).waitFor();
      check(`${tag} result reload and return link retain filter with no writes`, new URL(page.url()).search === query && await page.getByRole('link', { name: /Thư viện chương trình/ }).getAttribute('href') === library && writes().length === afterSubmitWrites);
      await page.getByRole('link', { name: /Thư viện chương trình/ }).click(); await page.getByRole('heading', { name: 'Other lesson' }).waitFor();
      check(`${tag} return keeps filter and canonical completion`, new URL(page.url()).pathname + new URL(page.url()).search === library && await page.getByRole('heading', { name: 'Lifecycle lesson', exact: true }).count() === (filter === 'completed' ? 1 : 0));
      await page.reload(); await page.getByRole('heading', { name: 'Other lesson' }).waitFor();
      check(`${tag} library reload keeps filter`, new URL(page.url()).search === `?filter=${filter}`);
      await page.getByRole('button', { name: 'Đã hoàn thành', exact: true }).click(); await page.getByRole('heading', { name: 'Lifecycle lesson', exact: true }).click(); await page.getByRole('link', { name: /Xem lại/ }).click(); await page.getByRole('heading', { name: 'Lifecycle result' }).waitFor();
      await page.goBack(); await page.getByRole('heading', { name: 'Chọn bài nghe' }).waitFor(); await page.goForward(); await page.getByRole('heading', { name: 'Lifecycle result' }).waitFor();
      check(`${tag} completed review Back/Forward is read-only`, new URL(page.url()).search === `?from=${path}&filter=completed` && writes().length === afterSubmitWrites);
      if (filter === 'completed') for (const bad of [`from=${path}&from=${path}&filter=new`, `from=${path}&filter=new&filter=new`, `from=${path === 'general' ? 'ielts' : 'general'}&filter=completed`, `from=https://evil.test&filter=new&return_to=https://evil.test`]) {
        await page.goto(`${BASE}${resultPath}?${bad}`); await page.getByRole('heading', { name: 'Lifecycle result' }).waitFor();
        check(`${room ? 'room ' : ''}${path} result rejects ${bad}`, await page.getByRole('link', { name: /Thư viện chương trình/ }).getAttribute('href') === `/listening/${path}` && writes().length === afterSubmitWrites);
      }
      check(`${tag} no extra writes, protected reveal or JS errors`, unexpected.length === 0 && !requests.some((r) => /\/reveal$|playback-started/.test(r.path)) && errors.length === 0);
      console.log(JSON.stringify({ room, path, filter, requests, unexpected, errors }));
    } finally { releaseAnswer?.(); await context.close(); }
  }
  console.log(`Listening programme context: ${checks}/${checks} passed`);
} finally { await browser.close(); }
