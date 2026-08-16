// Fixture-backed browser contract for native `/admin/students`.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-admin-students-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000097';
const fakeSession = JSON.stringify({
  access_token: 'admin-students-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: adminId, email: 'admin-students@local' },
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

const cohorts = [{ id: 'co-active', name: 'Lớp Nền Tảng', is_active: true }];
let students = [
  { id: 'st-a', student_code: 'A001', full_name: 'Andy <img src=x onerror=alert(1)>', user_id: null, cohort_id: null, cohort_name: null, cohort_lookup_failed: true, target_band: 7.5, current_band_estimate: 6.5, target_date: '2026-09-01', persona_notes: 'Ghi chú <script>alert(1)</script>' },
  { id: 'st-b', student_code: 'B001', full_name: 'Bình', user_id: 'user-b', cohort_id: 'co-missing', cohort_name: null, cohort_lookup_failed: true, target_band: null, current_band_estimate: null, target_date: null, persona_notes: null },
  { id: 'st-c', student_code: 'C001', full_name: 'Chi', user_id: 'user-c', cohort_id: 'co-active', cohort_name: 'Lớp Nền Tảng', cohort_lookup_failed: true, target_band: 8, current_band_estimate: 7, target_date: null, persona_notes: null },
];
let failStudentReads = false;
let failWritingSummary = true;
let openedAssignedProfile = false;
let failNextStudentRead = false;
let delayNextBulkWrite = false;

const requests = [];
const unexpectedWrites = [];
const allowedWrites = [
  /^POST \/admin\/students$/,
  /^PATCH \/admin\/students\/[^/]+$/,
  /^POST \/admin\/students\/import$/,
  /^POST \/admin\/cohorts\/[^/]+\/students\/bulk$/,
  /^POST \/api\/(analytics\/events|error-logs)$/,
];

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-students@local', role: 'admin' });
  if (parsed.pathname === '/admin/cohorts' && method === 'GET') return json({ cohorts });
  if (parsed.pathname === '/admin/students' && method === 'GET') {
    if (failStudentReads || failNextStudentRead) {
      failNextStudentRead = false;
      return json({ detail: 'fixture student read failed' }, 503);
    }
    const query = (parsed.searchParams.get('search') || '').toLowerCase();
    if (query === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return json([students[0]]);
    }
    if (query === 'fast') return json([students[2]]);
    if (query) return json(students.filter((student) => `${student.student_code} ${student.full_name}`.toLowerCase().includes(query)));
    return json(students);
  }
  if (parsed.pathname === '/admin/students' && method === 'POST') {
    const body = JSON.parse(request.postData() || '{}');
    const row = { id: 'st-new', user_id: null, cohort_id: null, cohort_name: null, cohort_lookup_failed: false, ...body };
    students = [row, ...students];
    return json(row, 201);
  }
  const studentMatch = parsed.pathname.match(/^\/admin\/students\/([^/]+)$/);
  if (studentMatch && method === 'GET') {
    const row = students.find((student) => student.id === studentMatch[1]);
    if (!row) return json({ detail: 'not found' }, 404);
    if (row.id === 'st-c') openedAssignedProfile = true;
    return json({ ...row, cohort_name: undefined, cohort_lookup_failed: undefined, essay_history: [{ id: 'essay-1', task_type: 'task2', status: 'delivered', created_at: '2026-08-01T00:00:00Z' }], listening: null });
  }
  if (studentMatch && method === 'PATCH') {
    const body = JSON.parse(request.postData() || '{}');
    const row = students.find((student) => student.id === studentMatch[1]);
    if (!row) return json({ detail: 'not found' }, 404);
    Object.assign(row, body);
    return json(row);
  }
  const writingMatch = parsed.pathname.match(/^\/admin\/writing\/students\/([^/]+)\/summary$/);
  if (writingMatch && method === 'GET') {
    if (failWritingSummary) return json({ detail: 'fixture writing summary failed' }, 503);
    return json({ stats: { total_essays: 1, graded_count: 1, flagged_count: 0, average_band_last5: 7 }, recent_essays: [], recent_assignments: [] });
  }
  const bulkMatch = parsed.pathname.match(/^\/admin\/cohorts\/([^/]+)\/students\/bulk$/);
  if (bulkMatch && method === 'POST') {
    if (delayNextBulkWrite) {
      delayNextBulkWrite = false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const body = JSON.parse(request.postData() || '{}');
    for (const student of students) if (body.student_ids.includes(student.id)) {
      student.cohort_id = bulkMatch[1]; student.cohort_name = 'Lớp Nền Tảng'; student.cohort_lookup_failed = false;
    }
    return json({ ok: true, assigned: body.student_ids.length, cohort_id: bulkMatch[1] });
  }
  if (parsed.pathname === '/admin/students/import' && method === 'POST') {
    return json({ imported: 1, errors: ['Dòng 3: thiếu full_name'] });
  }
  return json({});
});

const writeHasLaterCanonicalRead = (method, pathPattern) => {
  const index = requests.findIndex((item) => item.method === method && pathPattern.test(item.path));
  return index >= 0 && requests.slice(index + 1).some((item) => item.method === 'GET' && item.path === '/admin/students');
};

await page.goto(`${BASE}/admin/students`, { waitUntil: 'domcontentloaded' });
try { await page.getByRole('heading', { name: /Lớp.*Học viên/ }).waitFor({ state: 'visible' }); }
catch (error) {
  console.error('  URL:', page.url());
  console.error('  Body:', (await page.locator('body').innerText().catch(() => '')).slice(0, 1400));
  console.error('  JS:', pageErrors.join(' | '));
  throw error;
}
await page.getByText('Bình', { exact: true }).waitFor({ state: 'visible' });

check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('đọc roster giới hạn 200 và chỉ lớp active',
  requests.some((item) => item.path === '/admin/students' && item.search === '?limit=200')
  && requests.some((item) => item.path === '/admin/cohorts' && item.search === '?is_active=true'));
check('KPI dùng cohort_id, không dùng tên lớp',
  await page.locator('.acd-kpi strong').allTextContents().then((values) => values.map((value) => value.trim()).join('|') === '3|1|1'));
check('lookup lỗi không biến học viên đã xếp lớp thành chưa xếp',
  await page.locator('tr').filter({ hasText: 'Bình' }).getByText('Không đọc được tên lớp', { exact: true }).count() === 1
  && await page.locator('tr').filter({ hasText: 'Bình' }).getByText('Chưa xếp lớp', { exact: true }).count() === 0);
check('payload độc hại được React escape', await page.locator('.asd-shell img, .asd-shell script').count() === 0);
check('hard delete không được surface', await page.getByRole('button', { name: /xoá học viên/i }).count() === 0);

await page.getByLabel('Tìm học viên').fill('slow');
await page.waitForTimeout(360);
await page.getByLabel('Tìm học viên').fill('fast');
await page.getByText('Chi', { exact: true }).waitFor({ state: 'visible' });
await page.waitForTimeout(500);
check('response tìm kiếm cũ không ghi đè kết quả mới',
  await page.getByText('Chi', { exact: true }).count() === 1 && await page.getByText(/Andy/).count() === 0);
await page.getByLabel('Tìm học viên').fill('');
await page.getByText('Bình', { exact: true }).waitFor({ state: 'visible' });

await page.getByText('Chi', { exact: true }).click();
await page.getByRole('dialog').getByText('Lớp Nền Tảng', { exact: true }).waitFor({ state: 'visible' });
check('profile giữ cohort_name enrichment khi detail endpoint không trả tên lớp', openedAssignedProfile);
await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).last().click();

const andyRow = page.locator('tr').filter({ hasText: 'Andy' });
await andyRow.getByRole('button', { name: 'Sửa' }).click();
const editDialog = page.getByRole('dialog');
await editDialog.getByLabel('Band hiện tại').fill('');
await editDialog.getByLabel('Band mục tiêu').fill('');
await editDialog.getByLabel('Ngày mục tiêu').fill('');
await editDialog.getByLabel('Ghi chú học tập').fill('');
await editDialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.getByText('Đã cập nhật hồ sơ học viên.', { exact: true }).waitFor({ state: 'visible' });
const patch = requests.find((item) => item.method === 'PATCH' && item.path === '/admin/students/st-a');
const patchBody = JSON.parse(patch?.body || '{}');
check('edit gửi explicit null cho trường tuỳ chọn rồi canonical reload',
  patchBody.target_band === null && patchBody.current_band_estimate === null
  && patchBody.target_date === null && patchBody.persona_notes === null
  && writeHasLaterCanonicalRead('PATCH', /^\/admin\/students\/st-a$/));

await page.locator('tr').filter({ hasText: 'Andy' }).getByRole('checkbox').check();
await page.getByLabel('Lớp đích').selectOption('co-active');
delayNextBulkWrite = true;
await page.getByRole('button', { name: 'Xếp vào lớp' }).click();
await page.waitForTimeout(80);
check('checkbox bị khóa trong lúc bulk write đang chạy',
  await page.getByLabel('Chọn tất cả học viên trong kết quả').isDisabled()
  && await page.locator('tr').filter({ hasText: 'Andy' }).getByRole('checkbox').isDisabled());
await page.getByText('Đã xếp 1 học viên vào lớp.', { exact: true }).waitFor({ state: 'visible' });
check('xếp lớp bulk rồi canonical reload',
  writeHasLaterCanonicalRead('POST', /^\/admin\/cohorts\/co-active\/students\/bulk$/)
  && await page.locator('tr').filter({ hasText: 'Andy' }).getByText('Lớp Nền Tảng', { exact: true }).count() === 1);

await page.locator('tr').filter({ hasText: 'Bình' }).getByRole('checkbox').check();
await page.getByLabel('Lớp đích').selectOption('co-active');
failNextStudentRead = true;
await page.getByRole('button', { name: 'Xếp vào lớp' }).click();
await page.getByText(/Tuy nhiên chưa tải lại được dữ liệu chuẩn/).waitFor({ state: 'visible' });
check('write thành công nhưng reload lỗi vẫn xoá selection để không gửi lặp',
  await page.getByRole('region', { name: 'Xếp lớp hàng loạt' }).count() === 0);

await page.locator('tr').filter({ hasText: 'Chi' }).getByRole('checkbox').check();
await page.getByLabel('Lớp đích').selectOption('co-active');
delayNextBulkWrite = true;
await page.getByRole('button', { name: 'Xếp vào lớp' }).click();
await page.waitForTimeout(80);
check('stale retry và search bị khóa trong lúc mutation',
  await page.getByRole('button', { name: 'Thử lại' }).isDisabled()
  && await page.getByLabel('Tìm học viên').isDisabled());
await page.getByText('Đã xếp 1 học viên vào lớp.', { exact: true }).waitFor({ state: 'visible' });

await page.locator('input[type="file"]').setInputFiles({ name: 'students.csv', mimeType: 'text/csv', buffer: Buffer.from('student_code,full_name\nD1,Demo\n') });
await page.getByText('1 dòng CSV chưa import được', { exact: true }).waitFor({ state: 'visible' });
check('CSV lỗi hiện trên màn hình và reload canonical',
  await page.getByText('Dòng 3: thiếu full_name', { exact: true }).count() === 1
  && writeHasLaterCanonicalRead('POST', /^\/admin\/students\/import$/));

await page.getByRole('button', { name: /Xem tổng quan của Andy/i }).count().then(async (count) => {
  if (count) await page.getByRole('button', { name: /Xem tổng quan của Andy/i }).click();
  else await page.getByText(/Andy/).first().click();
});
await page.getByRole('dialog').getByText('Không tải được tổng quan Writing.', { exact: true }).waitFor({ state: 'visible' });
check('hồ sơ partial failure vẫn giữ dữ liệu profile chuẩn',
  await page.getByRole('dialog').getByText('Chưa kích hoạt', { exact: true }).count() >= 1
  && await page.getByRole('dialog').getByText('Không tải được tổng quan Writing.', { exact: true }).count() === 1);
await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).last().click();

failStudentReads = true;
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('Không tải được danh sách mới nhất', { exact: true }).waitFor({ state: 'visible' });
const failedKpis = await page.locator('.acd-kpi strong').allTextContents();
check('initial roster failure never becomes fake zero',
  failedKpis.length === 3 && failedKpis.every((value) => value.trim() === 'Chưa đọc được'), failedKpis.join(' | '));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Students native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
