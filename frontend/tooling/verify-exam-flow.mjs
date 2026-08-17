// Fixture-backed browser contract for the native authenticated `/exam` player.
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
const exam = {
  id: 'exam-1',
  exam_source: 'toeic_rc',
  title: 'Fixture TOEIC <img src=x>',
  time_limit_minutes: 10,
  total_questions: 2,
  questions: [
    { q_num: 2, question_type: 'mcq_single', prompt: 'Second ___', options: [{ label: 'A', text: 'wrong' }, { label: 'B', text: 'right' }] },
    { q_num: 5, question_type: 'mcq_single', prompt: 'Fifth ___', options: [{ label: 'A', text: 'alpha' }, { label: 'B', text: 'beta' }] },
  ],
};
const review = {
  attempt_id: 'attempt-1', test_id: 'exam-1', exam_source: 'toeic_rc', score: 1, max_score: 2, correct_count: 1,
  review: [
    {
      q_num: 2, correct: true, user_answer: 'B', expected: 'B', prompt: 'Second ___',
      stepper: {
        steps: [{ action: 'confirm', instruction_vi: 'Chốt B.', kp_refs: [{ type: 'grammar', category: 'verb-forms', slug: 'gerunds', title: 'Gerunds' }], microcheck: { prompt: 'Chọn lại', options: ['Sai', 'Đúng'], answer: 'B' } }],
        distractors: [{ option: 'A', why_wrong_vi: 'Không phù hợp ngữ cảnh.', kp_refs: [{ type: 'grammar', category: 'word-forms', slug: 'adjectives', title: 'Adjectives' }] }],
      },
    },
    { q_num: 5, correct: false, user_answer: '', expected: 'A', prompt: 'Fifth ___', stepper: null },
  ],
};

async function fixture({ signedIn = true, malformedList = false, failReviewOnce = false, malformedSubmitAck = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  const submitted = [];
  const microchecks = [];
  let reviewReads = 0;
  const supabaseStub = `
window.supabase = { createClient: function () { return { auth: {
  getSession: async function () { return { data: { session: ${signedIn ? `{ access_token: 'fixture-token', user: { id: 'exam-user', email: 'exam@example.com' } }` : 'null'} }, error: null }; },
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
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    const body = () => JSON.parse(request.postData() || '{}');
    if (request.method() === 'GET' && url.pathname === '/api/exams') {
      return json(malformedList ? { exams: [{ id: '', title: 'broken' }] } : { exams: [{
        id: exam.id, exam_source: exam.exam_source, title: exam.title,
        total_questions: exam.total_questions, time_limit_minutes: exam.time_limit_minutes,
      }] });
    }
    if (request.method() === 'GET' && url.pathname === '/api/exams/exam-1') return json(exam);
    if (request.method() === 'POST' && url.pathname === '/api/exams/exam-1/attempts') {
      submitted.push(body());
      if (malformedSubmitAck) return json({ ok: true });
      return json({ attempt_id: 'attempt-1', score: 1, max_score: 2, correct_count: 1 });
    }
    if (request.method() === 'GET' && url.pathname === '/api/exams/attempts/attempt-1/review') {
      reviewReads += 1;
      if (failReviewOnce && reviewReads === 1) return json({ detail: 'temporary' }, 503);
      return json(review);
    }
    if (request.method() === 'POST' && url.pathname === '/api/kp/microcheck-answers') {
      microchecks.push(body());
      return json({ ok: true });
    }
    if (url.pathname === '/api/error-logs') return json({ ok: true });
    return json({});
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  return { context, page, pageErrors, submitted, microchecks, get reviewReads() { return reviewReads; } };
}

const signedOut = await fixture({ signedIn: false });
await signedOut.page.goto(`${BASE}/exam`, { waitUntil: 'domcontentloaded' });
await signedOut.page.waitForURL('**/login');
check('không có session thì fail closed về canonical /login', signedOut.submitted.length === 0);
await signedOut.context.close();

const run = await fixture();
await run.page.goto(`${BASE}/exam?source=toeic_rc`, { waitUntil: 'domcontentloaded' });
await run.page.getByRole('heading', { name: 'Đề luyện tập' }).waitFor();
check('list giữ source filter và authored text được React escape',
  await run.page.locator('img').count() === 0 && (await run.page.locator('main').innerText()).includes('Fixture TOEIC <img src=x>'));
await run.page.getByRole('link', { name: /Fixture TOEIC/ }).click();
await run.page.waitForURL('**/exam?id=exam-1');
await run.page.getByRole('radio', { name: /B\. right/ }).check();
await run.page.getByRole('button', { name: 'Nộp bài' }).evaluate((node) => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await run.page.getByText('1 / 2', { exact: true }).waitFor();
check('double click chỉ POST đúng một lượt và gửi đủ q_num, kể cả câu bỏ trống',
  run.submitted.length === 1 && JSON.stringify(run.submitted[0].answers) === JSON.stringify([
    { q_num: 2, user_answer: 'B' }, { q_num: 5, user_answer: '' },
  ]));
await run.page.getByRole('button', { name: /Câu 2/ }).click();
await run.page.getByRole('button', { name: /A\. Sai/ }).click();
const mobileContained = await run.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
check('review hiện đáp án, KP stepper, micro-check và mobile không tràn',
  run.microchecks.length === 1
    && await run.page.getByRole('link', { name: /Gerunds/ }).count() === 1
    && await run.page.getByRole('region', { name: 'Phân tích đáp án nhiễu' }).getByText('Không phù hợp ngữ cảnh.').count() === 1
    && mobileContained
    && run.pageErrors.length === 0,
  `microchecks=${run.microchecks.length}; contained=${mobileContained}; errors=${run.pageErrors.join(' | ')}`);
await run.context.close();

const retry = await fixture({ failReviewOnce: true });
await retry.page.goto(`${BASE}/exam?id=exam-1`, { waitUntil: 'domcontentloaded' });
await retry.page.getByRole('heading', { name: /Fixture TOEIC/ }).waitFor();
await retry.page.getByRole('button', { name: 'Nộp bài' }).click();
await retry.page.getByRole('button', { name: 'Tải lại phần chữa bài' }).waitFor();
await retry.page.getByRole('button', { name: 'Tải lại phần chữa bài' }).click();
await retry.page.getByText('1 / 2', { exact: true }).waitFor();
check('không submit lại khi review GET lỗi; chỉ retry read caller-owned attempt',
  retry.submitted.length === 1 && retry.reviewReads === 2);
await retry.context.close();

const uncertain = await fixture({ malformedSubmitAck: true });
await uncertain.page.goto(`${BASE}/exam?id=exam-1`, { waitUntil: 'domcontentloaded' });
await uncertain.page.getByRole('heading', { name: /Fixture TOEIC/ }).waitFor();
await uncertain.page.getByRole('button', { name: 'Nộp bài' }).click();
const uncertainButton = uncertain.page.getByRole('button', { name: 'Chưa xác nhận được' });
await uncertainButton.waitFor();
await uncertainButton.click({ force: true });
check('ACK bất định khóa submit thay vì cho người học tạo lượt trùng',
  uncertain.submitted.length === 1 && await uncertainButton.isDisabled());
await uncertain.context.close();

const malformed = await fixture({ malformedList: true });
await malformed.page.goto(`${BASE}/exam`, { waitUntil: 'domcontentloaded' });
await malformed.page.getByText(/danh sách đề không đúng định dạng/).waitFor();
check('payload sai contract fail closed thay vì render đề giả', await malformed.page.locator('.nx-exam-card').count() === 0);
await malformed.context.close();

await browser.close();
if (results.some((result) => !result.ok)) process.exitCode = 1;
