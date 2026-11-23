// Fixture-backed browser contract for native instructor oversight.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-admin-instructors-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';
import { stubAdminMfaStatus } from './admin-mfa-stub.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000093';
const instructorId = 'teacher/id with space';
const fakeSession = JSON.stringify({ access_token: 'admin-instructors-not-a-real-token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-instructors@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launchChromium() { try { return await chromium.launch(); } catch (error) { const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome }); throw error; } }

const requests = [];
const unexpectedWrites = [];
const cohortWrites = [];
// One teacher per class: the fixture holds cohorts.instructor_id and derives
// both teacher pages from it, like the backend.
const cohorts = [
  { id: 'c-1', name: 'IELTS 6.5 tối', is_active: true, instructor_id: instructorId },
  { id: 'c-2', name: 'Foundation', is_active: true, instructor_id: 'teacher-2' },
  { id: 'c-3', name: 'Writing sprint', is_active: true, instructor_id: null },
];
const names = { [instructorId]: 'Cô <script>alert(1)</script>', 'teacher-2': 'Thầy Bình' };
const pendingByClass = { 'c-1': 6, 'c-2': 3, 'c-3': 0 };
const classesOf = (id) => cohorts.filter((c) => c.instructor_id === id).map((c) => ({ id: c.id, name: c.name, writing_pending: pendingByClass[c.id], writing_overdue: c.id === 'c-2' ? 1 : 0, speaking_mock_pending: null }));
const overviewOf = (id) => {
  const classes = classesOf(id);
  return { classes, writing_pending: classes.reduce((n, c) => n + c.writing_pending, 0), writing_overdue: classes.reduce((n, c) => n + c.writing_overdue, 0), delivered_30d: id === 'teacher-2' ? 9 : 2, in_progress: 1, avg_review_hours: id === 'teacher-2' ? 30 : null };
};
const teacherRows = () => [
  { instructor_id: instructorId, email: 'teacher<img src=x>@example.com', display_name: names[instructorId], students: 13, prompts: 8, graded: 21, regraded: 2, regrade_events: 7, tokens: 12345, cost_usd: 1.2345, ...overviewOf(instructorId) },
  { instructor_id: 'teacher-2', email: 'second@example.com', display_name: names['teacher-2'], students: 4, prompts: 2, graded: 5, regraded: 1, regrade_events: 1, tokens: 500, cost_usd: .25, ...overviewOf('teacher-2') },
];
const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
  const cohortPatch = method === 'PATCH' && /^\/admin\/cohorts\/[^/]+$/.test(parsed.pathname);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !cohortPatch && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) unexpectedWrites.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-instructors@local', role: 'admin' });
  if (parsed.pathname === '/admin/instructors') return json([...teacherRows(), { instructor_id: 'broken', students: -1 }]);
  if (parsed.pathname === '/admin/instructors/teacher-2') return json(teacherRows()[1]);
  if (parsed.pathname === '/admin/instructors/nobody') return json({ detail: 'Không tìm thấy giáo viên' }, 404);
  if (parsed.pathname === '/admin/cohorts') return json({ cohorts: cohorts.map((c) => ({ ...c, instructor: c.instructor_id ? { id: c.instructor_id, name: names[c.instructor_id] } : null })) });
  if (cohortPatch) {
    const body = JSON.parse(request.postData() || '{}');
    const cohort = cohorts.find((c) => `/admin/cohorts/${c.id}` === parsed.pathname);
    cohortWrites.push({ path: parsed.pathname, body });
    if (cohort) cohort.instructor_id = body.instructor_id;
    return json({ ...cohort });
  }
  return json({});
});
await stubAdminMfaStatus(page);

await page.goto(`${BASE}/admin/instructors`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Giảng viên', exact: true }).waitFor({ state: 'visible' });
await page.getByText('Cô <script>alert(1)</script>', { exact: true }).waitFor({ state: 'visible' });
check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
const canonicalReads = requests.filter((item) => item.path === '/admin/instructors' && item.method === 'GET');
check('đọc đúng endpoint canonical một lần', canonicalReads.length === 1, canonicalReads.map((item) => `${item.method} ${item.path}${item.search}`).join(', '));
check('tổng quan dùng đúng dữ liệu hợp lệ', await page.getByText('17', { exact: true }).count() >= 1 && await page.getByText('$1.4845', { exact: true }).count() === 1);
check('bảng nêu lớp đang dạy và bài chờ duyệt', await page.getByText('IELTS 6.5 tối', { exact: true }).count() === 1 && await page.getByText('1 quá hạn', { exact: true }).count() === 1);
check('duyệt trung bình để trống khi chưa đủ dữ liệu', await page.getByText('30 giờ', { exact: true }).count() === 1 && await page.locator('td[data-label="Duyệt trung bình"] .ain-muted').count() === 1);
check('cảnh báo bản ghi sai định dạng hiện rõ', await page.getByText(/1 bản ghi sai định dạng hoặc trùng mã/).count() === 1);
check('định danh độc hại được React escape', await page.locator('.ain-shell img, .ain-shell script, .ain-shell iframe').count() === 0);
const workspace = page.getByRole('link', { name: /Mở workspace đã audit của Cô <script>alert\(1\)<\/script>/ });
check('CTA dùng đúng sanctioned impersonation URL', await workspace.getAttribute('href') === '/instructor?as_instructor=teacher%2Fid%20with%20space');
await page.getByLabel('Tìm giảng viên').fill('second@');
check('tìm kiếm lọc client và đồng bộ URL', await page.getByText('Thầy Bình', { exact: true }).count() === 1 && await page.getByText('Cô <script>alert(1)</script>', { exact: true }).count() === 0 && new URL(page.url()).searchParams.get('q') === 'second@');
await page.getByLabel('Tìm giảng viên').fill('không có');
check('trạng thái không có kết quả không giả thành directory rỗng', await page.getByText('Không tìm thấy giảng viên', { exact: true }).count() === 1 && await page.getByText('Hiển thị 0 / 2 giảng viên', { exact: true }).count() === 1);
await page.getByLabel('Tìm giảng viên').fill('');
await page.getByText('Hiển thị 2 / 2 giảng viên', { exact: true }).waitFor({ state: 'visible' });
check('mobile xếp mỗi giảng viên thành một khối và không tràn ngang', await page.evaluate(() => (
  document.querySelectorAll('.ain-table tbody tr').length === 2
  && getComputedStyle(document.querySelector('.ain-table thead')).display === 'none'
  && document.documentElement.scrollWidth <= window.innerWidth
)));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop là bảng có tiêu đề cột và không tràn ngang', await page.evaluate(() => (
  document.documentElement.scrollWidth <= window.innerWidth
  && getComputedStyle(document.querySelector('.ain-table thead')).display !== 'none'
)));
await page.getByRole('button', { name: 'Bài chờ duyệt' }).click();
const firstRow = async () => (await page.locator('.ain-table tbody tr th').first().innerText()).trim();
check('sắp theo bài chờ duyệt, nhiều nhất trước, ghi vào URL', (await firstRow()).startsWith('C') && new URL(page.url()).searchParams.get('sort') === 'pending' && new URL(page.url()).searchParams.get('dir') === 'desc');
await page.getByRole('button', { name: 'Bài chờ duyệt' }).click();
check('bấm lần nữa đảo chiều', (await firstRow()).startsWith('T') && new URL(page.url()).searchParams.get('dir') === 'asc');
check('mở hồ sơ là route con', await page.getByRole('link', { name: 'Mở hồ sơ Thầy Bình' }).getAttribute('href') === '/admin/instructors/teacher-2');

// Profile: remove from a class, then move another class to this teacher.
await page.goto(`${BASE}/admin/instructors/teacher-2`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Thầy Bình', exact: true }).waitFor({ state: 'visible' });
check('hồ sơ đọc đúng endpoint', requests.some((item) => item.method === 'GET' && item.path === '/admin/instructors/teacher-2'));
check('hồ sơ có lớp được gán và khối lượng 30 ngày', await page.getByRole('link', { name: 'Foundation' }).count() === 1 && await page.getByText('Khối lượng duyệt · 30 ngày').count() === 1 && await page.getByText('30 giờ', { exact: true }).count() === 1);
await page.getByRole('button', { name: 'Gỡ khỏi lớp…' }).click();
const dialog = page.getByRole('dialog');
await dialog.waitFor({ state: 'visible' });
check('hộp hỏi lại nêu người, lớp và số bài chuyển về admin', await dialog.getByText('Gỡ Thầy Bình khỏi lớp Foundation?').count() === 1 && (await dialog.innerText()).includes('3 bài Writing chờ duyệt'));
await dialog.getByRole('button', { name: 'Gỡ khỏi lớp' }).click();
await page.getByText('Đã gỡ Thầy Bình khỏi lớp Foundation. Lớp hiện chưa có giáo viên.').waitFor({ state: 'visible' });
check('gỡ gửi instructor_id null và tải lại hồ sơ', cohortWrites.length === 1 && cohortWrites[0].path === '/admin/cohorts/c-2' && cohortWrites[0].body.instructor_id === null
  && await page.getByText('Chưa phụ trách lớp nào').count() === 1);
await page.getByLabel('Lớp', { exact: true }).selectOption('c-1');
await page.getByRole('button', { name: 'Chuyển lớp sang giáo viên này' }).click();
await dialog.waitFor({ state: 'visible' });
check('chuyển lớp nói người cũ mất quyền', (await dialog.innerText()).includes('mất quyền với lớp ngay'));
await dialog.getByRole('button', { name: 'Chuyển lớp' }).click();
await page.getByText('Đã chuyển lớp IELTS 6.5 tối sang Thầy Bình.').waitFor({ state: 'visible' });
check('chuyển lớp một bước, lớp chỉ còn ở hồ sơ mới', cohortWrites.length === 2 && cohortWrites[1].body.instructor_id === 'teacher-2'
  && await page.getByRole('link', { name: 'IELTS 6.5 tối' }).count() === 1 && classesOf(instructorId).length === 0);
await page.setViewportSize({ width: 390, height: 844 });
check('hồ sơ ở 390 không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await page.goto(`${BASE}/admin/instructors/nobody`, { waitUntil: 'domcontentloaded' });
await page.getByText('Không tìm thấy giảng viên', { exact: true }).waitFor({ state: 'visible' });
check('hồ sơ không phải giảng viên hiện "Không tìm thấy"', true);
check('không có write ngoài contract (chỉ PATCH /admin/cohorts/{id})', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Instructors native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
