// Fixture-backed browser contract for native class submission/marking.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-admin-class-submissions-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000096';
const cohortId = 'submissions-fixture';
const fakeSession = JSON.stringify({
  access_token: 'admin-class-submissions-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: adminId, email: 'admin-class-submissions@local' },
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launchChromium() {
  try { return await chromium.launch(); }
  catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome });
    throw error;
  }
}

const cohort = { id: cohortId, name: 'Grammar Course 1', course_id: 'course-1', is_active: true };
const members = [
  { student_id: 'st-a', student_code: 'A001', name: 'An', user_id: 'u-a', sessions: 2, ai_cost_usd: 0 },
  { student_id: 'st-b', student_code: 'B001', name: 'Bình', user_id: null, sessions: 0, ai_cost_usd: 0 },
];
const assignment = { id: 'asg-course', title: 'Grammar 2', skill: 'course', kind: 'daily', status: 'published', due_at: '2026-08-20T12:00:00Z', content_id: 'bank-2', content_config: { test_title: 'Grammar 2', pass_pct: 75, retake_size: 20 }, recipient_scope: 'class', progress: { assigned: 2, submitted: 1, late: 0, missing: 0, no_account: 1 } };
let returned = false;
const requests = [];
const unexpectedWrites = [];
const allowedWrites = [
  new RegExp(`^POST /admin/cohorts/${cohortId}/assignments/asg-course/return/st-a$`),
  /^POST \/api\/(analytics\/events|error-logs)$/,
];

const tally = () => ({
  assignment: { id: assignment.id, title: assignment.title, skill: assignment.skill, due_at: assignment.due_at },
  sealed: false, homework_stale: false, writing_total: 1,
  students: [
    { student_id: 'st-a', name: 'An', student_code: 'A001', status: returned ? 'pending' : 'submitted', submitted_at: returned ? null : '2026-08-12T02:00:00Z', score: 68, flags: [], flag_level: null, passed_at: null, retakes: 1, verdicts: 2, artifact_kind: returned ? null : 'course_writing', artifact_id: returned ? null : 'writing-1', has_writing: !returned, writing_expected: true },
    { student_id: 'st-b', name: 'Bình', student_code: 'B001', status: 'no-account', submitted_at: null, score: null, flags: [], flag_level: null, passed_at: null, retakes: 0, verdicts: 0, artifact_kind: null, artifact_id: null, has_writing: false, writing_expected: true },
  ],
  counts: { total: 2, submitted: returned ? 0 : 1, late: 0, missing: 0, no_account: 1, flagged: 0 },
});

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (_) {} }, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url);
  const method = request.method();
  requests.push({ method, path: parsed.pathname, search: parsed.search, body: request.postData() });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const signature = `${method} ${parsed.pathname}`;
    if (!allowedWrites.some((pattern) => pattern.test(signature))) unexpectedWrites.push(signature);
  }
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-class-submissions@local', role: 'admin' });
  if (parsed.pathname === '/admin/courses') return json({ courses: [{ id: 'course-1', code: 'C1', name: 'Khoá 1', is_active: true }] });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/members`) return json({ cohort, member_count: members.length, members });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/assignments` && method === 'GET') return json({ assignments: [assignment], reconcile_failed: false });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/assignments/asg-course/tally`) return json(tally());
  if (parsed.pathname === '/admin/quiz/banks/bank-2/attempt-report') return json({
    stale: false, stages_total: 8, writing_total: 1,
    students: [
      { student_id: 'st-a', user_id: 'u-a', state: 'done', wrote: true, stages_done: 8, minutes: 32.5, questions: 60, correct: 41, accuracy: 0.683, median_sec: 18, idle_sec: 0, last_at: '2026-08-12T02:00:00Z' },
      { student_id: 'st-b', user_id: null, state: 'untouched', wrote: false, stages_done: 0, minutes: 0, questions: 0, correct: 0, accuracy: null, median_sec: null, idle_sec: 0, last_at: null },
      { student_id: null, user_id: 'u-gone', state: 'done', wrote: false, stages_done: 8, minutes: 28, questions: 60, correct: 48, accuracy: 0.8, median_sec: 15, idle_sec: 0, last_at: '2026-08-11T02:00:00Z' },
    ],
    axes: [{ axis: 'Articles', wrong: 5, median_sec: 22 }],
  });
  if (parsed.pathname === '/admin/quiz/banks/bank-2/students/u-a/report') return json({
    stale: false, locked: false,
    totals: { answered: 2, correct: 1, median_sec: 18, active_sec: 75, idle_sec: 0, bank_title: 'Grammar 2' },
    history: [{ number: 1, phase: 'run', session_count: 8, pct: 68, next_action: 'retake', at: '2026-08-12T02:00:00Z' }, { number: 2, phase: 'retake', session_count: 1, pct: 60, next_action: 'retry_full', at: '2026-08-12T03:00:00Z' }],
    questions: [{ qid: 'q1', item_key: 'Articles', prompt: 'Choose the article.', picked_text: 'a', answer_text: 'an', is_correct: false, why_wrong: 'Âm đầu là nguyên âm.', explain: 'Dùng an trước âm nguyên âm.', seconds: 21 }, { qid: 'q2', item_key: 'Articles', prompt: 'Choose another article.', picked_text: 'the', answer_text: 'the', is_correct: true, seconds: 17 }],
  });
  if (parsed.pathname === '/admin/quiz/banks/bank-2/students/u-gone/report') return json({ stale: false, locked: false, totals: { answered: 1, correct: 1, median_sec: 15, active_sec: 15, idle_sec: 0, bank_title: 'Grammar 2' }, history: [], questions: [{ qid: 'gone-q1', item_key: 'Articles', prompt: 'Archived learner question.', picked_text: 'the', answer_text: 'the', is_correct: true, seconds: 15 }] });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/assignments/asg-course/writing/st-a`) return json({ student: { id: 'st-a', name: 'An', code: 'A001' }, assignment: { id: 'asg-course', title: 'Grammar 2' }, submission: { clean: 1, total: 2, model: 'fixture-grader', graded_at: '2026-08-12T02:00:00Z', items: [{ prompt: 'Write one sentence.', answer: 'I has a cat.', corrected: 'I have a cat.', issues: [{ before: 'has', after: 'have', note: 'Agreement' }], explain: 'Chủ ngữ I đi với have.' }] } });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/assignments/asg-course/return/st-a` && method === 'POST') { returned = true; return json({ returned: true, draft_restored: 1, audit_logged: true }); }
  return json({});
});

const reads = (path) => requests.filter((item) => item.method === 'GET' && item.path === path);
await page.goto(`${BASE}/admin/classes/${cohortId}?assignment_id=asg-course`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Grammar 2', exact: true }).waitFor({ state: 'visible' });
check('assignment_id tự vào tab Bài tập và mở workspace native', await page.getByRole('tab', { name: /Bài tập/ }).getAttribute('aria-selected') === 'true' && page.url().includes('assignment_id=asg-course'));
check('không điều hướng sang rollback legacy', !page.url().includes('/pages/admin/classes/index.html') && await page.locator('a[href*="/pages/admin/classes/index.html"]').count() === 0);
check('tally giữ trạng thái và mastery chuẩn', await page.getByText('1/ 2 đã nộp', { exact: true }).count() === 1 && await page.getByText('68%', { exact: true }).count() === 1 && await page.getByText(/Chưa đạt · KTL×1/).count() === 1);

await page.getByRole('tab', { name: 'Chi tiết làm bài' }).click();
await page.locator('tr').filter({ hasText: 'An' }).getByText('8/8 chặng', { exact: true }).waitFor({ state: 'visible' });
const effortTable = page.locator('#acs-panel-effort');
check('effort phân biệt xong, chưa kích hoạt và giữ học viên đã rời lớp', await effortTable.getByText('Đã đạt', { exact: true }).count() === 2 && await effortTable.getByText('Chưa mở', { exact: true }).count() === 1 && await effortTable.getByText('Chưa kích hoạt', { exact: true }).count() === 1 && await effortTable.getByText('Học viên đã rời lớp', { exact: true }).count() === 1);
check('trục yếu cả lớp đọc từ report chuẩn', await page.getByText('Articles', { exact: true }).count() === 1 && await page.getByText('5 sai', { exact: true }).count() === 1);

await page.locator('tr').filter({ hasText: 'An' }).getByRole('button', { name: 'Xem từng lượt' }).click();
await page.getByRole('heading', { name: 'An', exact: true }).waitFor({ state: 'visible' });
check('bài từng em ghép course report và tự luận', await page.getByText('I has a cat.', { exact: true }).count() === 1 && await page.getByText('Không có trục yếu nổi bật', { exact: true }).count() === 0);
check('history chỉ hiện session và revision đã chấm', await page.getByText('Full session', { exact: true }).count() === 1 && await page.getByText('Revision', { exact: true }).count() === 1 && await page.getByText('Làm lại toàn bộ', { exact: true }).count() === 1);

await page.getByRole('tab', { name: 'Chi tiết làm bài' }).click();
await page.locator('tr').filter({ hasText: 'Học viên đã rời lớp' }).getByRole('button', { name: 'Xem từng lượt' }).click();
await page.getByRole('heading', { name: 'Học viên đã rời lớp', exact: true }).waitFor({ state: 'visible' });
await page.getByRole('button', { name: /Articles/ }).click();
await page.getByText('Archived learner question.', { exact: true }).waitFor({ state: 'visible' });
check('học viên đã rời lớp vẫn mở được report bằng user_id chuẩn', true);

await page.getByRole('tab', { name: 'Ai nộp' }).click();
const tallyPath = `/admin/cohorts/${cohortId}/assignments/asg-course/tally`;
const readsBeforeReturn = reads(tallyPath).length;
await page.locator('.acs-tally-list article').filter({ hasText: 'An' }).getByRole('button', { name: 'Trả bài' }).click();
const dialog = page.getByRole('dialog');
await dialog.getByRole('button', { name: 'Trả bài', exact: true }).click();
await page.getByText(/Đã trả bài. 1 câu đã được đưa lại/).waitFor({ state: 'visible' });
const returnWriteIndex = requests.findIndex((item) => item.method === 'POST' && item.path.endsWith('/return/st-a'));
const canonicalReadAfter = returnWriteIndex >= 0 && requests.slice(returnWriteIndex + 1).some((item) => item.method === 'GET' && item.path === tallyPath);
check('trả bài reload canonical tally trước khi báo thành công', returned && reads(tallyPath).length > readsBeforeReturn && canonicalReadAfter);
check('canonical tally sau trả không còn nhận là đã nộp', await page.getByText('0/ 2 đã nộp', { exact: true }).count() === 1 && await page.getByText('Chưa nộp', { exact: true }).count() >= 1);
await page.getByRole('tab', { name: 'Chi tiết làm bài' }).click();
check('trả bài xoá effort cache và đọc lại nguồn chuẩn', reads('/admin/quiz/banks/bank-2/attempt-report').length >= 2);
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Class Submissions native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
