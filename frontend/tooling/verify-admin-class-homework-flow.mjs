// Fixture-backed browser contract for native class assignment lifecycle.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-admin-class-homework-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000097';
const cohortId = 'homework-fixture';
const fakeSession = JSON.stringify({
  access_token: 'admin-class-homework-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: adminId, email: 'admin-class-homework@local' },
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
let assignments = [
  { id: 'asg-course', title: 'Grammar 1', skill: 'course', kind: 'daily', status: 'published', due_at: '2026-08-20T12:00:00Z', content_id: 'bank-1', content_config: { test_title: 'Grammar 1', pass_pct: 75, retake_size: 20 }, recipient_scope: 'subset', progress: { assigned: 1, submitted: 1, late: 0, missing: 0, no_account: 0 } },
  { id: 'asg-delete', title: 'Reading chưa làm', skill: 'reading', kind: 'daily', status: 'published', due_at: null, content_id: 'reading-1', content_config: { test_title: 'Reading 1' }, recipient_scope: 'class', progress: { assigned: 2, submitted: 0, late: 0, missing: 0, no_account: 1 } },
  { id: 'asg-unknown', title: 'Không rõ sổ nộp', skill: 'listening', kind: 'daily', status: 'published', due_at: null, content_id: 'listening-1', content_config: { test_title: 'Listening 1' }, recipient_scope: 'class', progress: null },
];
let reconcileFailed = true;
let failNextAssignments = false;
let dueNeedsConfirm = true;
let dueConflictNext = false;
const requests = [];
const unexpectedWrites = [];
const allowedWrites = [
  /^POST \/admin\/cohorts\/[^/]+\/assignments$/,
  /^PATCH \/admin\/cohorts\/[^/]+\/assignments\/[^/]+$/,
  /^DELETE \/admin\/cohorts\/[^/]+\/assignments\/[^/]+$/,
  /^PATCH \/admin\/cohorts\/[^/]+\/assignments\/[^/]+\/due$/,
  /^POST \/admin\/cohorts\/[^/]+\/assignments\/[^/]+\/backfill$/,
  /^POST \/api\/(analytics\/events|error-logs)$/,
];

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (_) {} }, [storageKey(SB), fakeSession]);
await context.addInitScript(() => {
  window.__homeworkAudioEvents = [];
  window.Audio = class FixtureAudio {
    constructor(src) { this.src = src; this.currentTime = 0; this.listeners = {}; window.__homeworkAudioEvents.push(['create', src]); window.__homeworkLastAudio = this; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    play() { window.__homeworkAudioEvents.push(['play', this.src]); return Promise.resolve(); }
    pause() { window.__homeworkAudioEvents.push(['pause', this.src]); }
    end() { this.listeners.ended?.(); }
  };
});
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-class-homework@local', role: 'admin' });
  if (parsed.pathname === '/admin/courses') return json({ courses: [{ id: 'course-1', code: 'C1', name: 'Khoá 1', is_active: true }] });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/members`) return json({ cohort, member_count: members.length, members });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/assignments` && method === 'GET') {
    if (failNextAssignments) { failNextAssignments = false; return json({ detail: 'fixture assignment reload failed' }, 503); }
    return json({ assignments, reconcile_failed: reconcileFailed });
  }
  if (parsed.pathname === `/admin/cohorts/${cohortId}/speaking-topics`) return json({ items: [
    { id: 'topic-1', title: 'Home and family', ready: true, already_given: false },
  ], part: 1, questions_per_give: 2 });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/speaking-topics/topic-1/questions`) return json({ items: [
    { id: 'q1', question_text: 'Where do you live?', giveable: true, audio_url: 'https://audio.fixture/q1.mp3' },
    { id: 'q2', question_text: 'Who do you live with?', giveable: true, audio_url: 'https://audio.fixture/q2.mp3' },
    { id: 'q3', question_text: 'What do you like about your home?', giveable: false, audio_url: null },
  ], part: 1, questions_per_give: 2 });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/course-banks`) return json({ items: [
    { id: 'bank-1', code: 'G01', title: 'Grammar 1', lesson_no: 1, ready: true, already_given: true },
    { id: 'bank-2', code: 'G02', title: 'Grammar 2', lesson_no: 2, ready: true, already_given: false },
  ] });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/assignments` && method === 'POST') {
    const body = JSON.parse(request.postData() || '{}');
    assignments = [{ id: 'asg-created', status: 'published', kind: body.kind, skill: body.skill, title: body.title, due_at: '2026-08-25T12:00:00Z', content_id: body.content_id, content_config: { test_title: 'Grammar 2', pass_pct: body.pass_pct, retake_size: body.retake_size }, recipient_scope: body.student_ids ? 'subset' : 'class', progress: { assigned: 1, submitted: 0, late: 0, missing: 0, no_account: 0 } }, ...assignments];
    reconcileFailed = false;
    return json({ student_count: 1, unactivated_count: 0 }, 201);
  }
  const dueMatch = parsed.pathname.match(new RegExp(`^/admin/cohorts/${cohortId}/assignments/([^/]+)/due$`));
  if (dueMatch && method === 'PATCH') {
    const body = JSON.parse(request.postData() || '{}');
    if (dueConflictNext) {
      dueConflictNext = false;
      const row = assignments.find((item) => item.id === dueMatch[1]);
      if (row) row.due_at = '2026-08-23T12:00:00Z';
      return json({ detail: { conflict: true, current_due_at: row?.due_at, message: 'Hạn đã đổi từ lúc mở trang.' } }, 409);
    }
    if (dueNeedsConfirm) {
      dueNeedsConfirm = false;
      return json({ detail: { needs_confirm: true, flips: { to_ontime: 1, to_late: 2 } } }, 409);
    }
    const row = assignments.find((item) => item.id === dueMatch[1]);
    if (row) row.due_at = '2026-08-22T12:00:00Z';
    return json({ due_at: row?.due_at, audit_logged: true });
  }
  const backfillMatch = parsed.pathname.match(new RegExp(`^/admin/cohorts/${cohortId}/assignments/([^/]+)/backfill$`));
  if (backfillMatch && method === 'POST') return json({ added: 1, student_count: 2 });
  const assignmentMatch = parsed.pathname.match(new RegExp(`^/admin/cohorts/${cohortId}/assignments/([^/]+)$`));
  if (assignmentMatch && method === 'PATCH') {
    const body = JSON.parse(request.postData() || '{}');
    const row = assignments.find((item) => item.id === assignmentMatch[1]);
    if (row) row.status = body.status;
    return json(row || {}, 200);
  }
  if (assignmentMatch && method === 'DELETE') {
    assignments = assignments.filter((item) => item.id !== assignmentMatch[1]);
    return route.fulfill({ status: 204, body: '' });
  }
  if (parsed.pathname === `/admin/cohorts/${cohortId}/action-log`) return json({ actions: [
    { id: 'log-1', action: 'due_change', created_at: '2026-08-12T01:00:00Z', actor_email: 'admin@local', assignment_title: 'Grammar 1', details: { previous_due_at: '2026-08-20T12:00:00Z', due_at: '2026-08-22T12:00:00Z', flips: { to_late: 2 } } },
  ], has_more: false, next_before: null });
  return json({});
});

const writes = (method, suffix) => requests.filter((item) => item.method === method && item.path.endsWith(suffix));
const hasReadAfter = (write) => {
  const index = requests.indexOf(write);
  return index >= 0 && requests.slice(index + 1).some((item) => item.method === 'GET' && item.path === `/admin/cohorts/${cohortId}/assignments`);
};

await page.goto(`${BASE}/admin/classes/${cohortId}?tab=homework`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Bài tập', exact: true }).waitFor({ state: 'visible' });
check('deep-link native homework khôi phục đúng tab', await page.getByRole('tab', { name: /Bài tập/ }).getAttribute('aria-selected') === 'true');
check('reconcile failure được hiện thay vì bịa số chuẩn', await page.getByText(/Chưa đối chiếu được một số bài đã nộp/).count() === 1);
const unknownRow = page.locator('tr').filter({ hasText: 'Không rõ sổ nộp' });
check('progress không đọc được không mở đường xoá', await unknownRow.getByText('Không đọc được', { exact: true }).count() === 1 && await unknownRow.getByRole('button', { name: 'Đóng bài' }).count() === 1 && await unknownRow.getByRole('button', { name: 'Xoá' }).count() === 0);
const markingButton = page.locator('tr').filter({ hasText: 'Grammar 1' }).getByRole('button', { name: 'Nhận bài' });
check('marking mở bằng workspace native', await markingButton.count() === 1 && await page.locator('a[href*="/pages/admin/classes/index.html"]').count() === 0);

await page.getByRole('button', { name: 'Giao bài mới' }).click();
let create = page.getByRole('dialog');
await create.getByLabel('Chủ đề').selectOption('topic-1');
await create.getByLabel('Tên bài giao').fill('Speaking theo thứ tự');
await create.getByText('Tôi tự chọn', { exact: true }).click();
const q1 = create.locator('.ach-question-row').filter({ has: page.getByText('Where do you live?', { exact: true }) });
const q2 = create.locator('.ach-question-row').filter({ has: page.getByText('Who do you live with?', { exact: true }) });
await q2.locator('input[type="checkbox"]').check();
await q1.locator('input[type="checkbox"]').check();
check('thứ tự chọn thủ công hiển thị đúng q2→q1', await q2.getByText(/Thứ tự chọn 1/).count() === 1 && await q1.getByText(/Thứ tự chọn 2/).count() === 1);
const q3 = create.locator('.ach-question-row').filter({ has: page.getByText('What do you like about your home?', { exact: true }) });
check('câu chưa có audio không hiện nút preview', await q3.getByRole('button').count() === 0);
await q1.getByRole('button', { name: 'Nghe thử: Where do you live?' }).click();
await q2.getByRole('button', { name: 'Nghe thử: Who do you live with?' }).click();
const audioEvents = await page.evaluate(() => window.__homeworkAudioEvents);
check('audio preview mới dừng audio trước', JSON.stringify(audioEvents) === JSON.stringify([
  ['create', 'https://audio.fixture/q1.mp3'], ['play', 'https://audio.fixture/q1.mp3'],
  ['pause', 'https://audio.fixture/q1.mp3'], ['create', 'https://audio.fixture/q2.mp3'], ['play', 'https://audio.fixture/q2.mp3'],
]));
check('nghe thử không đổi lựa chọn hoặc thứ tự', await q2.locator('input[type="checkbox"]').isChecked() && await q1.locator('input[type="checkbox"]').isChecked() && await q2.getByText(/Thứ tự chọn 1/).count() === 1 && await q1.getByText(/Thứ tự chọn 2/).count() === 1);
await page.evaluate(() => window.__homeworkLastAudio.end());
await q2.getByRole('button', { name: 'Nghe thử: Who do you live with?' }).waitFor({ state: 'visible' });
check('audio kết thúc trả nút về trạng thái nghe thử', true);
await q2.getByRole('button', { name: 'Nghe thử: Who do you live with?' }).click();
await create.getByRole('button', { name: 'Giao cho cả lớp' }).click();
await page.getByText('Đã giao bài cho 1 học viên.', { exact: true }).waitFor({ state: 'visible' });
const closeAudioEvents = await page.evaluate(() => window.__homeworkAudioEvents);
check('đóng hộp giao bài dừng audio đang phát', JSON.stringify(closeAudioEvents.slice(-3)) === JSON.stringify([
  ['create', 'https://audio.fixture/q2.mp3'], ['play', 'https://audio.fixture/q2.mp3'], ['pause', 'https://audio.fixture/q2.mp3'],
]));
const speakingWrite = writes('POST', `/cohorts/${cohortId}/assignments`).at(-1);
const speakingBody = JSON.parse(speakingWrite?.body || '{}');
check('payload Speaking giữ nguyên click order q2→q1', JSON.stringify(speakingBody.question_ids) === '["q2","q1"]', speakingWrite?.body || 'missing write');
check('giao Speaking được canonical reload trước success', hasReadAfter(speakingWrite));

await page.getByRole('button', { name: 'Giao bài mới' }).click();
create = page.getByRole('dialog');
await create.getByLabel('Kỹ năng').selectOption('course');
await create.getByLabel('Bộ bài tập').selectOption('bank-2');
await create.getByLabel('Tên bài giao').fill('Grammar 2 giao nhóm');
await create.getByLabel('Ngưỡng đạt (%)').fill('75');
await create.getByLabel('Số câu kiểm tra lại').fill('20');
await create.getByLabel('Giao cho', { exact: true }).selectOption('subset');
await create.getByText('An', { exact: true }).click();
const coursePostResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/admin/cohorts/${cohortId}/assignments`);
const courseReadResponse = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === `/admin/cohorts/${cohortId}/assignments`);
await create.getByRole('button', { name: 'Giao cho 1 học viên' }).click();
await Promise.all([coursePostResponse, courseReadResponse]);
await page.getByText('Đã giao bài cho 1 học viên.', { exact: true }).waitFor({ state: 'visible' });
const createWrite = writes('POST', `/cohorts/${cohortId}/assignments`).at(-1);
const createBody = JSON.parse(createWrite?.body || '{}');
check('course mastery và subset gửi đúng contract', createBody.pass_pct === 75 && createBody.retake_size === 20 && JSON.stringify(createBody.student_ids) === '["st-a"]');
check('giao bài được canonical reload trước success', hasReadAfter(createWrite));

const courseRow = page.locator('tr').filter({ hasText: 'Grammar 1' });
await courseRow.getByRole('button', { name: 'Đổi hạn' }).click();
const due = page.getByRole('dialog');
await due.getByLabel('Ngày hạn').fill('2026-08-22');
await due.getByRole('button', { name: 'Đổi hạn', exact: true }).click();
await due.getByText(/1 lượt trễ sẽ thành đúng hạn; 2 lượt đúng hạn sẽ thành trễ/).waitFor({ state: 'visible' });
await due.getByRole('button', { name: 'Vẫn đổi hạn' }).click();
await page.getByText('Đã đổi hạn theo giờ Việt Nam.', { exact: true }).waitFor({ state: 'visible' });
const dueWrites = writes('PATCH', '/due');
const firstDue = JSON.parse(dueWrites[0]?.body || '{}');
const secondDue = JSON.parse(dueWrites[1]?.body || '{}');
check('đổi hạn dùng compare-and-confirm với exact flips', firstDue.expected_due_at === '2026-08-20T12:00:00Z' && firstDue.confirm_rewrites === false && secondDue.confirm_rewrites === true && secondDue.confirmed_flips.to_late === 2);
check('đổi hạn canonical reload sau mutation', hasReadAfter(dueWrites[1]));

dueConflictNext = true;
await page.locator('tr').filter({ hasText: 'Grammar 1' }).getByRole('button', { name: 'Đổi hạn' }).click();
const conflictDue = page.getByRole('dialog');
await conflictDue.getByLabel('Ngày hạn').fill('2026-08-24');
await conflictDue.getByRole('button', { name: 'Đổi hạn', exact: true }).click();
await conflictDue.getByText(/Hạn đã đổi ở nơi khác thành/).waitFor({ state: 'visible' });
const retryPatchResponse = page.waitForResponse((response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname.endsWith('/due') && response.status() === 200);
const retryReadResponse = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === `/admin/cohorts/${cohortId}/assignments`);
await conflictDue.getByRole('button', { name: 'Đổi hạn', exact: true }).click();
await Promise.all([retryPatchResponse, retryReadResponse]);
await page.getByText('Đã đổi hạn theo giờ Việt Nam.', { exact: true }).waitFor({ state: 'visible' });
const conflictWrites = writes('PATCH', '/due').slice(-2);
const conflictRetry = JSON.parse(conflictWrites[1]?.body || '{}');
check('due conflict nạp current_due_at rồi retry bằng canonical expected value', conflictRetry.expected_due_at === '2026-08-23T12:00:00Z' && hasReadAfter(conflictWrites[1]), `${conflictWrites[1]?.body || 'missing write'}; reload=${hasReadAfter(conflictWrites[1])}`);

await page.locator('tr').filter({ hasText: 'Grammar 1' }).getByRole('button', { name: 'Bù học viên' }).click();
const backfill = page.getByRole('dialog');
await backfill.getByText('Bình', { exact: true }).click();
await backfill.getByRole('button', { name: 'Thêm 1 học viên' }).click();
await page.getByText('Đã thêm 1 học viên vào bài này.', { exact: true }).waitFor({ state: 'visible' });
const backfillWrite = writes('POST', '/backfill').at(-1);
const backfillBody = JSON.parse(backfillWrite?.body || '{}');
check('backfill subset không nới thành cả lớp', JSON.stringify(backfillBody.student_ids) === '["st-b"]' && hasReadAfter(backfillWrite), `${backfillWrite?.body || 'missing write'}; reload=${hasReadAfter(backfillWrite)}`);

await page.locator('tr').filter({ hasText: 'Không rõ sổ nộp' }).getByRole('button', { name: 'Đóng bài' }).click();
await page.getByText('Đã đóng bài. Học viên không còn thấy bài này.', { exact: true }).waitFor({ state: 'visible' });
const archiveWrite = writes('PATCH', '/asg-unknown').at(-1);
check('unknown progress chỉ cho archive và canonical reload', JSON.parse(archiveWrite?.body || '{}').status === 'archived' && hasReadAfter(archiveWrite));

await page.locator('tr').filter({ hasText: 'Reading chưa làm' }).getByRole('button', { name: 'Bù học viên' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Bù học viên còn thiếu' }).click();
await page.getByText('Đã thêm 1 học viên vào bài này.', { exact: true }).waitFor({ state: 'visible' });
const classBackfillWrite = writes('POST', '/backfill').at(-1);
check('backfill cả lớp gửi object rỗng thay vì subset giả', classBackfillWrite?.body === '{}' && hasReadAfter(classBackfillWrite), `${classBackfillWrite?.body || 'missing write'}; reload=${hasReadAfter(classBackfillWrite)}`);

await page.locator('tr').filter({ hasText: 'Reading chưa làm' }).getByRole('button', { name: 'Xoá' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Xoá bài giao' }).click();
await page.getByText('Đã xoá bài giao chưa có bài nộp.', { exact: true }).waitFor({ state: 'visible' });
const deleteWrite = writes('DELETE', '/asg-delete').at(-1);
check('delete chỉ qua confirmation và canonical reload', Boolean(deleteWrite) && hasReadAfter(deleteWrite));

await page.getByText(/Nhật ký thao tác/).click();
await page.getByText(/2 lượt đúng hạn thành trễ/).waitFor({ state: 'visible' });
const flipCount = await page.getByText(/2 lượt đúng hạn thành trễ/).count();
const logText = await page.locator('.ach-log').innerText();
check('action log hiển thị before→after và flips', logText.includes('→') && flipCount === 1, logText.replace(/\n/g, ' | '));

failNextAssignments = true;
await page.getByRole('button', { name: 'Tải lại' }).click();
await page.getByText('Không đọc được danh sách bài giao', { exact: true }).waitFor({ state: 'visible' });
const grammarCount = await page.getByText('Grammar 1', { exact: true }).count();
const staleCount = await page.getByText(/Danh sách dưới đây là ảnh chụp trước đó/).count();
check('reload lỗi giữ snapshot cũ và báo stale', grammarCount >= 1 && staleCount === 1, `grammar=${grammarCount}; stale=${staleCount}`);

check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Class Homework native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
