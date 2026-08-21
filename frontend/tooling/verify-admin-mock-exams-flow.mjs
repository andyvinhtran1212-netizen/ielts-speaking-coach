import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000182';
const session = JSON.stringify({ access_token: 'admin-mock-exams-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-mock-exams@local' } });
const requests = [];
const errors = [];
const results = [];
let assignments = [];
let failAssignmentLookup = true;
let exams = [
  { id: 'source-1', code: 'SOURCE-1', title: 'Đề gốc lớp C1', status: 'published', exam_mode: 'sequential', is_open: false, active_section: 'not_started', cohort_id: 'class-1', listening_test_id: 'lis-1', reading_test_id: 'read-1', writing_task1_prompt_id: 'w1', writing_task2_prompt_id: 'w2' },
  { id: 'draft-1', code: 'DRAFT-1', title: 'Đề nháp', status: 'draft', exam_mode: 'sequential', is_open: false, active_section: 'not_started', cohort_id: 'class-1', listening_test_id: 'lis-1', reading_test_id: 'read-1' },
  { id: 'retake-1', code: 'RETAKE-1', title: 'Đề test lại', status: 'published', exam_mode: 'retake', is_open: false, active_section: 'not_started', cohort_id: null, listening_test_id: null, reading_test_id: 'read-1' },
];

const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
page.on('dialog', (dialog) => void dialog.accept());
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  const parsed = new URL(url);
  if (url.startsWith(BASE)) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const method = request.method();
  const path = parsed.pathname;
  let body = null;
  try { body = request.postDataJSON(); } catch { /* no JSON body */ }
  requests.push({ method, path, body });
  const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  if (path === '/auth/me') return json({ id: adminId, email: 'admin-mock-exams@local', role: 'admin' });
  if (path === '/admin/cohorts') return json({ cohorts: [{ id: 'class-1', name: 'IELTS C1' }, { id: 'class-2', name: 'IELTS C2' }] });
  if (path === '/admin/mock-exams/reading-tests') return json({ items: [{ id: 'read-1', title: 'Reading paper', test_id: 'READ-PAPER' }] });
  if (path === '/admin/listening/tests') return json({ items: [{ id: 'lis-1', title: 'Listening paper', test_id: 'LISTEN-PAPER' }] });
  if (path === '/admin/writing/prompts') return json({ prompts: [{ id: 'w1', title: 'Chart', task_type: 'task1_academic' }, { id: 'w2', title: 'Essay', task_type: 'task2' }] });
  if (path === '/admin/mock-exams' && method === 'GET') return json({ exams });
  if (path === '/admin/mock-exams' && method === 'POST') {
    const created = { id: body.code === 'AMBIG-1' ? 'ambiguous-1' : 'created-1', ...body, status: 'draft', is_open: false, active_section: 'not_started' };
    exams = [created, ...exams];
    if (body.code === 'AMBIG-1') return route.abort('connectionfailed');
    return json(created);
  }
  const progressMatch = path.match(/^\/admin\/mock-exams\/([^/]+)\/section-progress$/);
  if (progressMatch) return json({ active_section: exams.find((row) => row.id === progressMatch[1])?.active_section || 'not_started', sections: { listening: { submitted: 2, total: 3 }, reading: { submitted: 0, total: 3 }, writing: { submitted: 0, total: 3 } } });
  const patchMatch = path.match(/^\/admin\/mock-exams\/([^/]+)$/);
  if (patchMatch && method === 'PATCH') {
    exams = exams.map((row) => row.id === patchMatch[1] ? { ...row, ...body } : row);
    return json(exams.find((row) => row.id === patchMatch[1]));
  }
  const openMatch = path.match(/^\/admin\/mock-exams\/([^/]+)\/open$/);
  if (openMatch && method === 'POST') {
    exams = exams.map((row) => row.id === openMatch[1] ? { ...row, is_open: body.is_open } : row);
    return json(exams.find((row) => row.id === openMatch[1]));
  }
  const advanceMatch = path.match(/^\/admin\/mock-exams\/([^/]+)\/advance$/);
  if (advanceMatch && method === 'POST') {
    exams = exams.map((row) => row.id === advanceMatch[1] ? { ...row, active_section: 'listening' } : row);
    return json({ active_section: 'listening' });
  }
  if (path === '/admin/mock-exams/source-1/retest-summary') return json({ students: [
    { user_id: 'student-1', student_name: 'Nguyễn An', skills: ['listening', 'reading'] },
    { user_id: 'student-1', student_name: 'Nguyễn An', skills: ['writing'] },
  ] });
  if (path === '/admin/mock-exams/retake-1/assignments' && method === 'GET') {
    if (failAssignmentLookup) return json({ detail: 'fixture assignment lookup failed' }, 503);
    return json({ assignments });
  }
  if (path === '/admin/mock-exams/retake-1/assignments' && method === 'POST') {
    assignments = body.assignments.map((row) => ({ ...row, student_name: 'Nguyễn An' }));
    return json({ assigned: ['student-1'], skipped: [], locked: [], refresh_failed: [] });
  }
  if (path === '/admin/exam-content') return json({ items: [{ id: 'reading-uuid', kind: 'reading', code: 'READ-PAPER', title: 'Reading paper', status: 'published', course_level: 'C1', cohort_ids: ['class-1'], exam_only: true }], levels: ['C1'], failed_kinds: [] });
  if (/^\/admin\/exam-content\/reading\/reading-uuid\/(level|cohorts)$/.test(path) && method === 'PATCH') return json({ ok: true });
  if (path === '/admin/reading/content/tests/READ-PAPER/exam-only' && method === 'POST') return json({ test_id: 'READ-PAPER', exam_only: false });
  return json({ detail: `unhandled fixture ${method} ${path}` }, 500);
});

const initialPaths = ['/auth/me', '/admin/mock-exams', '/admin/cohorts', '/admin/mock-exams/reading-tests', '/admin/listening/tests', '/admin/writing/prompts'];
const initialReads = Promise.all(initialPaths.map((path) => page.waitForResponse((response) => new URL(response.url()).pathname === path)));
await page.goto(`${BASE}/admin/mock-exams`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Quản lý đề thi' }).waitFor();
await initialReads;
check('backend-owned admin gate và toàn bộ picker canonical chạy', initialPaths.every((path) => requests.some((item) => item.path === path)));
await page.locator('.mex-progress-row').first().waitFor();
if (process.env.CAPTURE_UI) await page.screenshot({ path: '/tmp/admin-mock-exams-redesign.png', fullPage: true });
check('progress published hiển thị trạng thái thật', await page.locator('.mex-progress-row').filter({ hasText: '2/3 đã nộp' }).count() >= 1);

await page.getByLabel('Mã đề *').fill('NEW-1');
await page.getByLabel('Tiêu đề *').fill('Đề mới');
await page.getByLabel('Hình thức giao').selectOption('retake');
await page.getByRole('button', { name: 'Lưu đề nháp' }).click();
await page.getByText('Đã tạo đề nháp từ dữ liệu backend.').waitFor();
const createRequest = requests.find((item) => item.method === 'POST' && item.path === '/admin/mock-exams');
check('create retake gửi cohort null và reconcile bằng GET', createRequest?.body?.exam_mode === 'retake' && createRequest?.body?.cohort_id === null && requests.filter((item) => item.method === 'GET' && item.path === '/admin/mock-exams').length >= 2);

await page.getByLabel('Mã đề *').fill('AMBIG-1');
await page.getByLabel('Tiêu đề *').fill('Đề phản hồi gián đoạn');
await page.getByRole('button', { name: 'Lưu đề nháp' }).click();
await page.getByText('Đã xác nhận AMBIG-1 được tạo dù phản hồi ban đầu bị gián đoạn.').waitFor();
check('create mơ hồ không được retry và chỉ báo thành công sau canonical refetch', requests.filter((item) => item.method === 'POST' && item.path === '/admin/mock-exams' && item.body?.code === 'AMBIG-1').length === 1 && exams.filter((row) => row.code === 'AMBIG-1').length === 1);

const draftCard = page.getByRole('article').filter({ hasText: 'DRAFT-1' });
await draftCard.getByRole('button', { name: 'Publish & sẵn sàng giao' }).click();
await page.getByText('Đã publish DRAFT-1.').waitFor();
check('publish dùng PATCH canonical rồi refetch', requests.some((item) => item.method === 'PATCH' && item.path === '/admin/mock-exams/draft-1' && item.body?.status === 'published'));

const sourceCard = page.getByRole('article').filter({ hasText: 'SOURCE-1' });
await sourceCard.getByRole('button', { name: 'Mở kỳ' }).click();
await page.getByText('Đã mở kỳ SOURCE-1.').waitFor();
await sourceCard.getByRole('button', { name: 'Mở Listening' }).click();
await page.getByText('Đã chuyển SOURCE-1 sang Listening.').waitFor();
check('open và advance giữ from_section chống stale tab', requests.some((item) => item.path === '/admin/mock-exams/source-1/open' && item.body?.is_open === true) && requests.some((item) => item.path === '/admin/mock-exams/source-1/advance' && item.body?.from_section === 'not_started'));

const retakeCard = page.getByRole('article').filter({ hasText: 'RETAKE-1' });
const firstAssignmentRead = page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === '/admin/mock-exams/retake-1/assignments');
await retakeCard.getByRole('button', { name: 'Gán test lại' }).click();
const firstAssignmentResponse = await firstAssignmentRead;
const assignmentLoadAlert = page.getByText(/Không đọc được assignment hiện tại/);
await assignmentLoadAlert.waitFor({ state: 'visible' });
check('assignment lookup lỗi không giả thành danh sách rỗng', firstAssignmentResponse.status() === 503 && await page.getByText('Chưa gán học viên nào.', { exact: true }).count() === 0);
failAssignmentLookup = false;
await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
await page.getByText('Chưa gán học viên nào.', { exact: true }).waitFor({ state: 'visible' });
check('assignment lookup thử lại đọc được canonical state', true);
await page.getByLabel('Đề gốc').selectOption('source-1');
await page.getByText('Nguyễn An').waitFor();
check('kỹ năng thiếu nội dung bị khóa trước mutation', await page.getByLabel('Nguyễn An · Listening').isDisabled());
await page.getByRole('button', { name: 'Gán assignment đã chọn' }).click();
await page.getByText('Assignment hiện tại').waitFor();
const assignmentRequest = requests.find((item) => item.method === 'POST' && item.path === '/admin/mock-exams/retake-1/assignments');
check('retake gộp kỹ năng trùng, gửi deadline và chỉ kỹ năng servable', Boolean(assignmentRequest?.body?.assignments?.[0]?.open_until) && JSON.stringify(assignmentRequest?.body?.assignments?.[0]?.skills) === '["reading","writing"]');
await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();

const levelInput = page.getByLabel('Cấp khóa READ-PAPER');
await levelInput.fill('C2'); await levelInput.blur();
await page.waitForFunction(() => true);
await page.getByRole('button', { name: 'Sửa lớp' }).click();
await page.getByText('Lựa chọn này thay thế toàn bộ tập lớp hiện tại.').waitFor();
await page.getByRole('dialog').getByRole('checkbox', { name: 'IELTS C2', exact: true }).check();
await page.getByRole('button', { name: 'Lưu toàn bộ lớp' }).click();
await page.getByRole('button', { name: 'Trả về thư viện' }).click();
check('exam-content dùng đúng level/cohort replacement và reading release identity', requests.some((item) => item.path.endsWith('/level') && item.body?.course_level === 'C2') && requests.some((item) => item.path.endsWith('/cohorts') && item.body?.cohort_ids?.includes('class-2')) && requests.some((item) => item.path === '/admin/reading/content/tests/READ-PAPER/exam-only'));

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, control: parseFloat(getComputedStyle(document.querySelector('.mex-form-grid input')).minHeight) }));
check('mobile không tràn trang và control đạt 44px', mobile.width <= mobile.viewport && mobile.control >= 44, `${mobile.width}/${mobile.viewport}, ${mobile.control}px`);
check('không có lỗi JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Mock Exams native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
