// Fixture-backed browser contract for native student-centric class work.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-admin-class-student-work-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000095';
const cohortId = 'student-work-fixture';
const fakeSession = JSON.stringify({
  access_token: 'admin-student-work-not-a-real-token', refresh_token: 'x', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: adminId, email: 'admin-student-work@local' },
});
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launchChromium() {
  try { return await chromium.launch(); }
  catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome });
    throw error;
  }
}

const cohort = { id: cohortId, name: 'Grammar Course 1', course_id: 'course-1', is_active: true };
const members = [{ student_id: 'st-a', student_code: 'A001', name: 'An <img src=x>', user_id: 'u-a', sessions: 2, ai_cost_usd: 0 }];
const courseAssignment = { id: 'asg-course', title: 'Grammar 2', skill: 'course', kind: 'daily', status: 'published', due_at: '2026-08-20T12:00:00Z', content_id: 'bank-2', content_config: { pass_pct: 75, retake_size: 20 }, recipient_scope: 'class', progress: { assigned: 1, submitted: 1, late: 0, missing: 0, no_account: 0 } };
const requests = [];
const unexpectedWrites = [];

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
  requests.push({ method, path: parsed.pathname, search: parsed.search });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) unexpectedWrites.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-student-work@local', role: 'admin' });
  if (parsed.pathname === '/admin/courses') return json({ courses: [{ id: 'course-1', code: 'C1', name: 'Khoá 1', is_active: true }] });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/members`) return json({ cohort, member_count: 1, members });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/progress`) return json({ students: [{ student_id: 'st-a', student_code: 'A001', name: 'An <img src=x>', activated: true, target_band: 7, skills: { speaking: { attempts: 1, last_activity: null, last_band: 6.5, recent_bands: [6.5] }, writing: { attempts: 0, recent_bands: [] }, reading: { attempts: 0, recent_bands: [] }, listening: { attempts: 0, recent_bands: [] } }, homework: { assigned: 3, submitted: 2, late: 1, missing: 1, on_time_pct: 50 } }], degraded: [] });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/students/st-a/work`) return json({
    student: { id: 'st-a', name: 'An <img src=x>', student_code: 'A001', activated: true }, homework_stale: true,
    items: [
      { assignment_id: 'asg-course', title: 'Grammar 2', skill: 'course', due_at: courseAssignment.due_at, archived: false, status: 'submitted', submitted_at: '2026-08-12T02:00:00Z', score: 68, artifact_kind: 'course_writing', artifact_id: 'writing-1', has_writing: true, bank_id: 'bank-2' },
      { assignment_id: 'asg-speaking', title: 'Speaking daily', skill: 'speaking', due_at: '2026-08-19T12:00:00Z', archived: true, status: 'late', submitted_at: '2026-08-20T12:00:00Z', score: 6.5, artifact_kind: 'session', artifact_id: 'session-1', has_writing: false, bank_id: null },
      { assignment_id: 'asg-missing', title: 'Reading chưa nộp', skill: 'reading', due_at: '2026-08-18T12:00:00Z', archived: false, status: 'missing', score: null, artifact_kind: null, artifact_id: null, has_writing: false, bank_id: null },
    ],
  });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/assignments`) return json({ assignments: [courseAssignment], reconcile_failed: false });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/assignments/asg-course/tally`) return json({ assignment: { id: 'asg-course', title: 'Grammar 2', skill: 'course', due_at: courseAssignment.due_at }, sealed: false, homework_stale: false, writing_total: 1, students: [{ student_id: 'st-a', name: 'An <img src=x>', student_code: 'A001', status: 'submitted', submitted_at: '2026-08-12T02:00:00Z', score: 68, flags: [], flag_level: null, passed_at: null, retakes: 1, verdicts: 1, artifact_kind: 'course_writing', artifact_id: 'writing-1', has_writing: true, writing_expected: true }], counts: { total: 1, submitted: 1, late: 0, missing: 0, no_account: 0, flagged: 0 } });
  if (parsed.pathname === '/admin/quiz/banks/bank-2/attempt-report') return json({ stale: false, stages_total: 8, writing_total: 1, students: [{ student_id: 'st-a', user_id: 'u-a', state: 'done', wrote: true, stages_done: 8, questions: 60, correct: 41, accuracy: .683 }], axes: [] });
  if (parsed.pathname === '/admin/quiz/banks/bank-2/students/u-a/report') return json({ stale: false, locked: false, totals: { answered: 1, correct: 0, bank_title: 'Grammar 2' }, history: [{ number: 1, phase: 'run', session_count: 8, pct: 68, next_action: 'retake', at: '2026-08-12T02:00:00Z' }], questions: [{ qid: 'q1', item_key: 'Articles', prompt: 'Choose.', picked_text: 'a', answer_text: 'an', is_correct: false }] });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/assignments/asg-course/writing/st-a`) return json({ student: { id: 'st-a', name: 'An', code: 'A001' }, assignment: { id: 'asg-course', title: 'Grammar 2' }, submission: { clean: 0, total: 1, items: [{ prompt: 'Write.', answer: 'I has.', corrected: 'I have.', issues: [] }] } });
  return json({});
});

await page.goto(`${BASE}/admin/classes/${cohortId}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: cohort.name }).waitFor({ state: 'visible' });
await page.locator('tr').filter({ hasText: 'An <img src=x>' }).getByRole('button', { name: 'Xem bài' }).click();
const dialog = page.getByRole('dialog');
await dialog.getByRole('heading', { name: 'An <img src=x>' }).waitFor({ state: 'visible' });
check('roster mở lịch sử bằng endpoint một-học-viên', requests.some((item) => item.path.endsWith('/students/st-a/work')) && new URL(page.url()).searchParams.get('student_id') === 'st-a');
check('React escape tên và lịch sử giữ đủ trạng thái chuẩn', await dialog.locator('img').count() === 0 && await dialog.locator('.acw-item').filter({ hasText: 'Grammar 2' }).getByText('Đã nộp', { exact: true }).count() === 1 && await dialog.locator('.acw-item').filter({ hasText: 'Speaking daily' }).getByText('Nộp trễ', { exact: true }).count() === 1 && await dialog.locator('.acw-item').filter({ hasText: 'Reading chưa nộp' }).getByText('Không nộp', { exact: true }).count() === 1);
check('partial reconcile được cảnh báo thay vì giả danh sách đầy đủ', await dialog.getByText(/Danh sách hoặc trạng thái bên dưới có thể còn thiếu/).count() === 1);
check('chỉ artifact thật có hành động', await dialog.getByRole('link', { name: 'Nghe bài' }).getAttribute('href') === '/admin/speaking/sessions?session=session-1' && await dialog.getByRole('button', { name: 'Xem tự luận' }).count() === 1 && await dialog.getByText('Chưa có bài để mở').count() === 1);

await dialog.getByRole('button', { name: 'Xem tự luận' }).click();
await page.getByRole('heading', { name: 'Grammar 2', exact: true }).waitFor({ state: 'visible' });
await page.getByText('I has.', { exact: true }).waitFor({ state: 'visible' });
check('mở course vào đúng bài từng em và giữ deep-link', await page.getByRole('heading', { name: 'An <img src=x>', exact: true }).count() === 1 && new URL(page.url()).searchParams.get('assignment_id') === 'asg-course' && new URL(page.url()).searchParams.get('student_id') === 'st-a');
await page.getByRole('button', { name: /Quay lại bài của An/ }).click();
await page.getByRole('dialog').waitFor({ state: 'visible' });
check('quay lại đúng hồ sơ học viên và không rơi về danh sách chung', new URL(page.url()).searchParams.get('student_id') === 'st-a' && new URL(page.url()).searchParams.get('assignment_id') === null);
await page.getByRole('dialog').locator('.acd-dialog__actions').getByRole('button', { name: 'Đóng', exact: true }).click();
check('đóng hồ sơ dọn student deep-link', new URL(page.url()).searchParams.get('student_id') === null);

await page.getByRole('tab', { name: /Tiến độ 4 kỹ năng/ }).click();
await page.locator('#acx-panel-progress tr').getByRole('button', { name: 'Xem bài' }).click();
await page.getByRole('dialog').waitFor({ state: 'visible' });
check('progress dùng cùng student workspace', new URL(page.url()).searchParams.get('tab') === 'progress' && new URL(page.url()).searchParams.get('student_id') === 'st-a');
await page.goto(`${BASE}/admin/classes/${cohortId}?student_id=st-a&assignment_id=asg-course`, { waitUntil: 'domcontentloaded' });
await page.getByText('I has.', { exact: true }).waitFor({ state: 'visible' });
check('deep-link ban đầu chỉ mở đúng bài từng em sau khi xác nhận phạm vi', await page.getByRole('heading', { name: 'An <img src=x>', exact: true }).count() === 1 && requests.filter((item) => item.path.endsWith('/students/st-a/work')).length >= 4);
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Class Student Work native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
