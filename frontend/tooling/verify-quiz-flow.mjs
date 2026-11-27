// Fixture-backed browser contract for the native authenticated /quiz player.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3011';
const API = 'https://api.quiz-fixture.invalid';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launch() {
  // CHROMIUM_EXECUTABLE: a preinstalled Chromium when the pinned Playwright build is absent.
  try { return await chromium.launch(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

const browser = await launch();
const sessionId = '00000000-0000-4000-8000-000000000001';
const bank = {
  bank: {
    id: 'bank-1',
    code: 'fixture-quiz',
    title: 'Fixture Quick-Check',
    skill_area: 'vocab',
    meta: {
      correct_to_master: 1,
      require_distinct_skill: false,
      require_production_to_master: false,
      provisional_on_single_mcq: false,
      max_attempts_per_word: 4,
    },
  },
  questions: [
    {
      qid: 'q-choice', item_key: 'alpha', input: 'choice', type: 'meaning', skill: 'meaning',
      prompt: 'Choose alpha.', options: ['Distractor', 'Correct choice'], answer: 1,
      explain: 'Why the correct choice is right.',
    },
    {
      qid: 'q-text', item_key: 'beta', input: 'text', type: 'recall', skill: 'recall',
      prompt: 'Type the answer ____', accept: ['answer'], explain: 'Type it exactly like this.',
    },
  ],
  word_cards: {
    alpha: { headword: 'alpha', pronunciation: '/ˈælfə/', definition_vi: 'chữ cái đầu tiên', example: 'Alpha comes first.' },
  },
};

const masteredResume = [
  { item_key: 'alpha', skills_passed: ['meaning'], credit_count: 1, production_done: true, status: 'mastered' },
  { item_key: 'beta', skills_passed: ['recall'], credit_count: 1, production_done: true, status: 'mastered' },
];

async function fixture({
  signedIn = true,
  resume = [],
  progressFailures = 0,
  resetAmbiguous = false,
  sessionDelayMs = 0,
  endDelayMs = 0,
  viewport = { width: 390, height: 844 },
  // EXAMDRILL-0073: the practice-room branch ('drill' in examRoomSurfaces).
  drill = false,
  progressStatus = 503,
} = {}) {
  const context = await browser.newContext({ viewport });
  const pageErrors = [];
  const sessionBodies = [];
  const progressBodies = [];
  const endBodies = [];
  // Learner API calls in order (telemetry and error logs left out): FR-001 compares both branches.
  const calls = [];
  let dialogs = 0;
  let resumeState = structuredClone(resume);
  let resetPosts = 0;
  let resumeReads = 0;
  let remainingProgressFailures = progressFailures;
  const supabaseStub = `
window.__AVER_SUPABASE_CLIENT__ = { auth: {
  getSession: async function () { return { data: { session: ${signedIn ? `{ access_token: 'fixture-token', user: { id: 'quiz-user', email: 'quiz@example.com' } }` : 'null'} }, error: null }; },
  onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} };`;

  await context.addInitScript({ content: supabaseStub });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname) || url.hostname === 'unpkg.com') return route.abort();
    if (url.origin === BASE) {
      if (url.pathname === '/js/runtime-config.js') {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({apiBase:${JSON.stringify(API)}${drill ? ",environment:'staging',examRoomSurfaces:['drill']" : ''}});`,
        });
      }
      if (request.isNavigationRequest() && url.pathname === '/login') {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>login</title><h1>Login</h1>' });
      }
      return route.continue();
    }

    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,x-request-id',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    const body = () => JSON.parse(request.postData() || '{}');
    if (!['/api/analytics/events', '/api/error-logs'].includes(url.pathname)) calls.push(`${request.method()} ${url.pathname}`);

    if (request.method() === 'GET' && url.pathname === '/api/quiz/banks/bank-1') return json(bank);
    if (request.method() === 'GET' && url.pathname === '/api/quiz/banks/bank-1/resume') {
      resumeReads += 1;
      return json(resumeState);
    }
    if (request.method() === 'POST' && url.pathname === '/api/quiz/sessions') {
      sessionBodies.push(body());
      if (sessionDelayMs) await new Promise((resolve) => setTimeout(resolve, sessionDelayMs));
      return json({ session_id: sessionId, resume: resumeState }, 201);
    }
    if (request.method() === 'POST' && url.pathname === `/api/quiz/sessions/${sessionId}/progress`) {
      progressBodies.push(body());
      if (remainingProgressFailures > 0) {
        remainingProgressFailures -= 1;
        return json({ detail: 'temporary' }, progressStatus);
      }
      return json({ ok: true });
    }
    if (request.method() === 'PATCH' && url.pathname === `/api/quiz/sessions/${sessionId}`) {
      endBodies.push(body());
      if (endDelayMs) await new Promise((resolve) => setTimeout(resolve, endDelayMs));
      return json({ ok: true });
    }
    if (request.method() === 'POST' && url.pathname === '/api/quiz/banks/bank-1/reset') {
      resetPosts += 1;
      resumeState = [];
      if (resetAmbiguous) return route.abort('connectionfailed');
      return json({ ok: true });
    }
    if (url.pathname === '/api/error-logs') return json({ ok: true });
    return json({});
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('dialog', (dialog) => { dialogs += 1; if (drill) void dialog.dismiss(); });
  return {
    context, page, pageErrors, sessionBodies, progressBodies, endBodies, calls,
    get dialogs() { return dialogs; },
    get resetPosts() { return resetPosts; },
    get resumeReads() { return resumeReads; },
  };
}

const signedOut = await fixture({ signedIn: false });
await signedOut.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
await signedOut.page.waitForURL('**/login');
check('không có session thì fail closed về canonical /login', signedOut.sessionBodies.length === 0);
await signedOut.context.close();

const run = await fixture({ progressFailures: 1, endDelayMs: 150 });
await run.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
await run.page.getByRole('heading', { name: 'Fixture Quick-Check' }).waitFor();
let answered = 0;
let choseWrong = false;
let modalContract = false;
for (let guard = 0; guard < 8; guard += 1) {
  // Finalization temporarily has neither a prompt nor the completed heading.
  // Wait for either stable state instead of requesting a vanished prompt.
  await run.page.locator('.qz-prompt')
    .or(run.page.getByRole('heading', { name: '🎉 Hoàn tất phiên!' }))
    .first().waitFor();
  if (await run.page.getByRole('heading', { name: '🎉 Hoàn tất phiên!' }).count()) break;
  const prompt = await run.page.locator('.qz-prompt').innerText();
  if (prompt.includes('Choose alpha')) {
    await run.page.getByRole('button', { name: choseWrong ? 'Correct choice' : 'Distractor' }).click();
    if (!choseWrong) {
      choseWrong = true;
      const opener = run.page.getByRole('button', { name: '📇 Xem nhanh thẻ từ' });
      await opener.click();
      const dialog = run.page.getByRole('dialog');
      await dialog.waitFor();
      const close = run.page.getByRole('button', { name: 'Đóng', exact: true }).first();
      const initiallyFocused = await run.page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Đóng');
      await run.page.keyboard.press('Shift+Tab');
      const trapped = await run.page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
      await run.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      const restored = await opener.evaluate((node) => document.activeElement === node);
      modalContract = initiallyFocused && trapped && restored;
    }
  } else {
    const input = run.page.getByRole('textbox');
    await input.fill('answer');
    await run.page.waitForFunction(() => {
      const button = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Kiểm tra');
      return button && !button.disabled;
    });
    await input.press('Enter');
  }
  answered += 1;
  const next = run.page.getByRole('button', { name: 'Tiếp →' });
  await next.waitFor({ timeout: 5_000 }).catch(async () => {
    throw new Error(`feedback did not open after prompt ${JSON.stringify(prompt)}: ${JSON.stringify(await run.page.locator('main').innerText())}`);
  });
  await next.evaluate((node) => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await next.waitFor({ state: 'detached' });
}
await run.page.getByRole('heading', { name: '🎉 Hoàn tất phiên!' }).waitFor();
await run.page.getByRole('button', { name: /Hiện tất cả/ }).click();
const reviewText = await run.page.locator('.qz-review-item').allInnerTexts();
const mobileContained = await run.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const attempts = run.progressBodies.flatMap((payload) => payload.attempts || []);
const uniqueAttempts = new Set(attempts.map((row) => row.client_id)).size;
check('player làm đủ choice + text, không bỏ câu khi bấm Tiếp lặp',
  answered === 3 && uniqueAttempts === 3,
  `answered=${answered}; uniqueAttempts=${uniqueAttempts}`);
check('progress lỗi một lần được retry trước khi chốt session',
  run.progressBodies.length === 2 && run.endBodies.length === 1 && run.endBodies[0].ended_by === 'completed');
check('bảng tổng kết giữ câu sai, đáp án và giải thích',
  reviewText.some((text) => text.includes('Từng trả lời sai') && text.includes('Why the correct choice is right'))
    && reviewText.some((text) => text.includes('Type it exactly like this')));
check('modal trap/khôi phục focus, mobile không tràn và không có lỗi JS',
  modalContract && mobileContained && run.pageErrors.length === 0,
  `modal=${modalContract}; contained=${mobileContained}; errors=${run.pageErrors.join(' | ')}`);
check('normal boot chỉ tạo đúng một session và summary không báo lưu lỗi',
  run.sessionBodies.length === 1 && await run.page.locator('.qz-save-warning').count() === 0);
const oldBranchCalls = [...run.calls];
check('cờ tắt: trang cũ, không có khung phòng luyện', await run.page.locator('[data-exam-room]').count() === 0);
await run.context.close();

const gateReview = await fixture({ resume: masteredResume, sessionDelayMs: 150 });
await gateReview.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
const reviewButton = gateReview.page.getByRole('button', { name: '🔁 Ôn tập lại' });
await reviewButton.waitFor();
await reviewButton.evaluate((node) => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await gateReview.page.getByRole('heading', { name: 'Fixture Quick-Check' }).waitFor();
check('gate Ôn tập lại khoá click lặp và chỉ tạo một session', gateReview.sessionBodies.length === 1);
await gateReview.context.close();

const gateReset = await fixture({ resume: masteredResume, resetAmbiguous: true, sessionDelayMs: 100 });
gateReset.page.on('dialog', (dialog) => void dialog.accept());
await gateReset.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
const resetButton = gateReset.page.getByRole('button', { name: '♻️ Làm lại từ đầu' });
await resetButton.waitFor();
await resetButton.evaluate((node) => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await gateReset.page.getByRole('heading', { name: 'Fixture Quick-Check' }).waitFor();
check('reset mất ACK được reconcile, không replay mutation và khởi động lại đúng một phiên',
  gateReset.resetPosts === 1 && gateReset.resumeReads === 2 && gateReset.sessionBodies.length === 1,
  `reset=${gateReset.resetPosts}; reads=${gateReset.resumeReads}; sessions=${gateReset.sessionBodies.length}`);
check('gate/reset không có lỗi JavaScript', gateReview.pageErrors.length === 0 && gateReset.pageErrors.length === 0,
  [...gateReview.pageErrors, ...gateReset.pageErrors].join(' | '));
await gateReset.context.close();

// ---- EXAMDRILL-0073: the same flows in the practice room ('drill' on) ----
const ROOM_PROMPT = /Choose alpha|Type the answer/;
const ROOM_SUMMARY = { name: 'Xong phiên' };

const drillSignedOut = await fixture({ signedIn: false, drill: true });
await drillSignedOut.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
await drillSignedOut.page.waitForURL('**/login');
check('drill: chưa đăng nhập lúc tải trang vẫn về /login, không hộp', drillSignedOut.sessionBodies.length === 0 && drillSignedOut.dialogs === 0);
await drillSignedOut.context.close();

const drillRun = await fixture({ progressFailures: 1, endDelayMs: 150, drill: true });
await drillRun.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
await drillRun.page.locator('[data-exam-room][data-surface="drill"][data-mode="practice"]').waitFor();
const bar = drillRun.page.locator('header').first();
check('drill: thanh trên có Thoát, tên bài và "Câu 1"',
  await bar.getByRole('button', { name: /Thoát/ }).count() === 1
    && (await bar.innerText()).includes('Fixture Quick-Check') && /Câu 1 · Đã thuộc 0\/2/.test(await bar.innerText()),
  await bar.innerText());
let drillAnswered = 0;
let drillWrong = false;
let drillCard = false;
const counters = [];
for (let guard = 0; guard < 8; guard += 1) {
  await drillRun.page.getByText(ROOM_PROMPT).or(drillRun.page.getByRole('heading', ROOM_SUMMARY)).first().waitFor();
  if (await drillRun.page.getByRole('heading', ROOM_SUMMARY).count()) break;
  counters.push((/Câu (\d+)/.exec(await bar.innerText()) || [])[1]);
  const prompt = await drillRun.page.getByText(ROOM_PROMPT).innerText();
  if (prompt.includes('Choose alpha')) {
    await drillRun.page.getByRole('button', { name: drillWrong ? 'Correct choice' : 'Distractor' }).click();
    if (!drillWrong) {
      drillWrong = true;
      const opener = drillRun.page.getByRole('button', { name: 'Xem nhanh thẻ từ' });
      await opener.click();
      const dialog = drillRun.page.getByRole('dialog', { name: 'alpha' });
      await dialog.waitFor();
      await drillRun.page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      drillCard = await opener.evaluate((node) => document.activeElement === node);
    }
    check(`drill: phản hồi "Đúng."/"Sai." sau câu ${drillAnswered + 1}`, await drillRun.page.getByText(/^(Đúng|Sai)\.$/).count() === 1);
  } else {
    const input = drillRun.page.getByRole('textbox', { name: 'Đáp án của bạn' });
    await input.fill('answer');
    await input.press('Enter');
  }
  drillAnswered += 1;
  const next = drillRun.page.getByRole('button', { name: 'Câu tiếp theo' });
  await next.waitFor({ timeout: 5_000 });
  await next.evaluate((node) => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await next.waitFor({ state: 'detached' });
}
await drillRun.page.getByRole('heading', ROOM_SUMMARY).waitFor();
await drillRun.page.getByRole('button', { name: /Hiện tất cả/ }).click();
const drillReview = await drillRun.page.locator('.qz-review-item').allInnerTexts();
const drillAttempts = drillRun.progressBodies.flatMap((payload) => payload.attempts || []);
check('drill: làm đủ choice + text, "Câu N" tăng theo từng câu, bấm lặp không bỏ câu',
  drillAnswered === 3 && new Set(drillAttempts.map((row) => row.client_id)).size === 3 && counters.join(',') === '1,2,3',
  `answered=${drillAnswered}; counters=${counters.join(',')}`);
check('drill: progress lỗi một lần được retry trước khi chốt session',
  drillRun.progressBodies.length === 2 && drillRun.endBodies.length === 1 && drillRun.endBodies[0].ended_by === 'completed');
check('drill: tổng kết giữ câu sai, đáp án và giải thích',
  drillReview.some((text) => text.includes('Từng trả lời sai') && text.includes('Why the correct choice is right'))
    && drillReview.some((text) => text.includes('Type it exactly like this')));
check('drill: thẻ từ đóng bằng Esc và trả tiêu điểm', drillCard);
// The two /auth/ reads come from the shared auth runtime and race each other, so
// they are compared as a set; every quiz call must match in the same order.
const quizCalls = (calls) => calls.filter((call) => !call.includes(' /auth/'));
const authCalls = (calls) => calls.filter((call) => call.includes(' /auth/')).sort();
check('drill: cùng request, cùng thứ tự như cờ tắt (FR-001)',
  JSON.stringify(quizCalls(drillRun.calls)) === JSON.stringify(quizCalls(oldBranchCalls))
    && JSON.stringify(authCalls(drillRun.calls)) === JSON.stringify(authCalls(oldBranchCalls)),
  `off=${oldBranchCalls.join(' > ')} | on=${drillRun.calls.join(' > ')}`);
check('drill: điện thoại không tràn ngang, 0 hộp gốc trình duyệt, không lỗi JS',
  await drillRun.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && drillRun.dialogs === 0 && drillRun.pageErrors.length === 0,
  `dialogs=${drillRun.dialogs}; errors=${drillRun.pageErrors.join(' | ')}`);
await drillRun.context.close();

const drillReset = await fixture({ resume: masteredResume, resetAmbiguous: true, sessionDelayMs: 100, drill: true });
await drillReset.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
const drillResetButton = drillReset.page.getByRole('button', { name: 'Làm lại từ đầu' });
await drillResetButton.waitFor();
await drillResetButton.evaluate((node) => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
const resetBox = drillReset.page.getByRole('alertdialog', { name: 'Xoá tiến độ của bài này?' });
await resetBox.waitFor();
const keepFocused = await resetBox.getByRole('button', { name: 'Giữ tiến độ' }).evaluate((node) => document.activeElement === node);
await resetBox.getByRole('button', { name: 'Giữ tiến độ' }).click();
const keptPosts = drillReset.resetPosts;
await drillResetButton.click();
await resetBox.getByRole('button', { name: 'Xoá và làm lại' }).click();
await drillReset.page.getByText(ROOM_PROMPT).waitFor();
check('drill: làm lại hỏi bằng hộp trong trang, "Giữ tiến độ" là tiêu điểm đầu và không gọi reset',
  keepFocused && keptPosts === 0);
check('drill: reset mất ACK được reconcile, một lần reset, một phiên mới, 0 hộp gốc',
  drillReset.resetPosts === 1 && drillReset.resumeReads === 2 && drillReset.sessionBodies.length === 1 && drillReset.dialogs === 0,
  `reset=${drillReset.resetPosts}; reads=${drillReset.resumeReads}; sessions=${drillReset.sessionBodies.length}; dialogs=${drillReset.dialogs}`);
await drillReset.context.close();

const drillOffline = await fixture({ progressFailures: 99, drill: true });
await drillOffline.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
await drillOffline.page.getByText(ROOM_PROMPT).waitFor();
const offlinePrompt = await drillOffline.page.getByText(ROOM_PROMPT).innerText();
if (offlinePrompt.includes('Choose alpha')) await drillOffline.page.getByRole('button', { name: 'Correct choice' }).click();
else { await drillOffline.page.getByRole('textbox', { name: 'Đáp án của bạn' }).fill('answer'); await drillOffline.page.getByRole('button', { name: 'Kiểm tra' }).click(); }
await drillOffline.page.getByRole('button', { name: 'Câu tiếp theo' }).waitFor();
await drillOffline.page.getByRole('button', { name: /Thoát/ }).first().click();
await drillOffline.page.getByText(/Còn 1 câu chưa lưu/).waitFor();
check('drill: Thoát khi còn câu chưa lưu thì hỏi kèm số câu, không rời trang',
  new URL(drillOffline.page.url()).pathname === '/quiz' && drillOffline.dialogs === 0);
await drillOffline.context.close();

// Codex P2 on #2597: an answer still in the outbox (below the batch size) is not
// "saved"; reload is guarded, while Thoát still flushes first and leaves at once.
const drillQueued = await fixture({ drill: true });
await drillQueued.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
await drillQueued.page.getByText(ROOM_PROMPT).waitFor();
const queuedPrompt = await drillQueued.page.getByText(ROOM_PROMPT).innerText();
if (queuedPrompt.includes('Choose alpha')) await drillQueued.page.getByRole('button', { name: 'Correct choice' }).click();
else { await drillQueued.page.getByRole('textbox', { name: 'Đáp án của bạn' }).fill('answer'); await drillQueued.page.getByRole('button', { name: 'Kiểm tra' }).click(); }
await drillQueued.page.getByRole('button', { name: 'Câu tiếp theo' }).waitFor();
const reloadGuarded = await drillQueued.page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
const saidSaved = await drillQueued.page.getByText(/Đã lưu/).count();
check('drill: câu còn trong outbox chặn tải lại trang và thanh trên không báo "Đã lưu"',
  reloadGuarded && saidSaved === 0 && drillQueued.progressBodies.length === 0, `guarded=${reloadGuarded}; saved=${saidSaved}; posts=${drillQueued.progressBodies.length}`);
await drillQueued.page.getByRole('button', { name: /Thoát/ }).first().click();
await drillQueued.page.waitForURL((url) => url.pathname !== '/quiz');
check('drill: Thoát vẫn lưu trước rồi rời trang ngay, không hỏi', drillQueued.progressBodies.length === 1 && drillQueued.dialogs === 0);
await drillQueued.context.close();

const drillExpired = await fixture({ progressFailures: 99, progressStatus: 401, drill: true });
await drillExpired.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
await drillExpired.page.getByText(ROOM_PROMPT).waitFor();
const expiredPrompt = await drillExpired.page.getByText(ROOM_PROMPT).innerText();
if (expiredPrompt.includes('Choose alpha')) await drillExpired.page.getByRole('button', { name: 'Correct choice' }).click();
else { await drillExpired.page.getByRole('textbox', { name: 'Đáp án của bạn' }).fill('answer'); await drillExpired.page.getByRole('button', { name: 'Kiểm tra' }).click(); }
await drillExpired.page.getByRole('button', { name: 'Câu tiếp theo' }).waitFor();
await drillExpired.page.getByRole('button', { name: /Thoát/ }).first().click();
await drillExpired.page.getByText('Phiên đăng nhập đã hết hạn').waitFor();
check('drill: 401 giữa bài hiện hộp đăng nhập lại, không chuyển sang /login, bài còn trên trang',
  new URL(drillExpired.page.url()).pathname === '/quiz' && await drillExpired.page.getByText(ROOM_PROMPT).count() === 1 && drillExpired.dialogs === 0);
await drillExpired.context.close();

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nQuiz flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
