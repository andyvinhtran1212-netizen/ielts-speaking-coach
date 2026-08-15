// Fixture-backed browser contract for the native authenticated /quiz player.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3011';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launch() {
  try { return await chromium.launch(); } catch (error) {
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
  viewport = { width: 390, height: 844 },
} = {}) {
  const context = await browser.newContext({ viewport });
  const pageErrors = [];
  const sessionBodies = [];
  const progressBodies = [];
  const endBodies = [];
  let resumeState = structuredClone(resume);
  let resetPosts = 0;
  let resumeReads = 0;
  let remainingProgressFailures = progressFailures;
  const supabaseStub = `
window.supabase = { createClient: function () { return { auth: {
  getSession: async function () { return { data: { session: ${signedIn ? `{ access_token: 'fixture-token', user: { id: 'quiz-user', email: 'quiz@example.com' } }` : 'null'} }, error: null }; },
  onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} }; } };`;

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('supabase-js')) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: supabaseStub });
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname) || url.hostname === 'unpkg.com') return route.abort();
    if (url.origin === BASE) {
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
        return json({ detail: 'temporary' }, 503);
      }
      return json({ ok: true });
    }
    if (request.method() === 'PATCH' && url.pathname === `/api/quiz/sessions/${sessionId}`) {
      endBodies.push(body());
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
  return {
    context, page, pageErrors, sessionBodies, progressBodies, endBodies,
    get resetPosts() { return resetPosts; },
    get resumeReads() { return resumeReads; },
  };
}

const signedOut = await fixture({ signedIn: false });
await signedOut.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
await signedOut.page.waitForURL('**/login');
check('không có session thì fail closed về canonical /login', signedOut.sessionBodies.length === 0);
await signedOut.context.close();

const run = await fixture({ progressFailures: 1 });
await run.page.goto(`${BASE}/quiz?bank=bank-1`, { waitUntil: 'domcontentloaded' });
await run.page.getByRole('heading', { name: 'Fixture Quick-Check' }).waitFor();
let answered = 0;
let choseWrong = false;
let modalContract = false;
for (let guard = 0; guard < 8; guard += 1) {
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
  await run.page.waitForTimeout(25);
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

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nQuiz flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
