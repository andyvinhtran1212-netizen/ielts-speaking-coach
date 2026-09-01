// Fixture-backed browser contract for native `/admin/classes`.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-admin-classes-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000096';
const fakeSession = JSON.stringify({
  access_token: 'admin-classes-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: adminId, email: 'admin-classes@local' },
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

const courses = [
  { id: 'course-active', code: 'C1', name: 'Nền tảng', is_active: true, sort_order: 1 },
  { id: 'course-old', code: 'C0', name: 'Khoá cũ', is_active: false, sort_order: 2 },
];
let cohorts = [
  { id: 'co-active', name: 'Lớp Nền Tảng', code_prefix: 'AUG4', description: '<img src=x onerror=alert(1)>', course_id: 'course-active', course: courses[0], member_count: 13, unactivated_count: 2, is_active: true, created_at: '2026-08-01T00:00:00Z' },
  { id: 'co-orphan', name: 'Lớp Liên Kết Cũ', code_prefix: null, description: null, course_id: 'course-missing', course: null, member_count: 4, unactivated_count: 0, is_active: true, created_at: '2026-07-01T00:00:00Z' },
  { id: 'co-archived', name: 'Lớp Đã Lưu', code_prefix: 'OLD', description: null, course_id: 'course-old', course: courses[1], member_count: 9, unactivated_count: 5, is_active: false, created_at: '2026-06-01T00:00:00Z' },
];
let failCohortReads = false;

const requests = [];
const unexpectedWrites = [];
const allowedWrites = [/^POST \/admin\/cohorts$/, /^PATCH \/admin\/cohorts\/[^/]+$/, /^POST \/api\/(analytics\/events|error-logs)$/];
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-classes@local', role: 'admin' });
  if (parsed.pathname === '/admin/courses' && method === 'GET') return json({ courses });
  if (parsed.pathname === '/admin/cohorts' && method === 'GET') {
    if (failCohortReads) return json({ detail: 'fixture cohort read failed' }, 503);
    return json({ cohorts, course_lookup_failed: true });
  }
  if (parsed.pathname === '/admin/cohorts' && method === 'POST') {
    const body = JSON.parse(request.postData() || '{}');
    const course = courses.find((item) => item.id === body.course_id) || null;
    const row = { id: 'co-created', ...body, course, member_count: 0, unactivated_count: 0, is_active: true, created_at: '2026-08-12T00:00:00Z' };
    cohorts = [row, ...cohorts];
    return json(row);
  }
  const cohortMatch = parsed.pathname.match(/^\/admin\/cohorts\/([^/]+)$/);
  if (cohortMatch && method === 'PATCH') {
    const body = JSON.parse(request.postData() || '{}');
    const row = cohorts.find((item) => item.id === cohortMatch[1]);
    if (!row) return json({ detail: 'not found' }, 404);
    Object.assign(row, body);
    if (Object.hasOwn(body, 'course_id')) row.course = courses.find((item) => item.id === body.course_id) || null;
    return json(row);
  }
  return json({});
});

const writeHasLaterCanonicalRead = (method, pathPattern) => {
  const index = requests.findIndex((item) => item.method === method && pathPattern.test(item.path));
  return index >= 0 && requests.slice(index + 1).some((item) => item.method === 'GET' && item.path === '/admin/cohorts' && item.search === '?with_rollup=true');
};

await page.goto(`${BASE}/admin/classes`, { waitUntil: 'domcontentloaded' });
try { await page.getByRole('heading', { name: /Lớp.*Học viên/ }).waitFor({ state: 'visible' }); }
catch (error) {
  console.error('  URL:', page.url());
  console.error('  Body:', (await page.locator('body').innerText().catch(() => '')).slice(0, 1200));
  console.error('  JS:', pageErrors.join(' | '));
  throw error;
}
await page.getByText('Lớp Nền Tảng', { exact: true }).waitFor({ state: 'visible' });

check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('đọc đúng rollup opt-in và toàn bộ course',
  requests.some((item) => item.path === '/admin/cohorts' && item.search === '?with_rollup=true')
  && requests.some((item) => item.path === '/admin/courses' && item.search === ''));
check('KPI chỉ tính lớp active',
  await page.getByText('2 / 3', { exact: true }).count() === 1
  && await page.getByText('17', { exact: true }).count() === 1
  && await page.getByText('2', { exact: true }).count() >= 1);
check('payload độc hại được React escape', await page.locator('.acd-shell img, .acd-shell script').count() === 0);
check('course lookup lỗi hiển thị rõ, không biến thành chưa gán',
  await page.getByText('Không đọc được khoá', { exact: true }).count() === 1
  && await page.locator('tr').filter({ hasText: 'Lớp Liên Kết Cũ' }).getByText('Chưa gán khoá', { exact: true }).count() === 0);

await page.getByLabel('Tìm lớp').fill('nen tang');
check('tìm kiếm không dấu lọc đúng',
  await page.getByText('Lớp Nền Tảng', { exact: true }).count() === 1
  && await page.getByText('Lớp Liên Kết Cũ', { exact: true }).count() === 0);
await page.getByRole('button', { name: 'Xóa lọc' }).click();

const orphanRow = page.locator('tr').filter({ hasText: 'Lớp Liên Kết Cũ' });
await orphanRow.getByRole('button', { name: 'Sửa' }).click();
let dialog = page.getByRole('dialog');
await dialog.getByLabel('Tên lớp').fill('');
await dialog.getByLabel('Tên lớp').pressSequentially('Lớp Liên Kết Mới');
check('controlled modal giữ focus qua nhiều ký tự', await dialog.getByLabel('Tên lớp').inputValue() === 'Lớp Liên Kết Mới');
check('course mồ côi vẫn là option được chọn', await dialog.getByLabel('Khóa học').inputValue() === 'course-missing');
await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.getByText('Đã lưu thông tin lớp.', { exact: true }).waitFor({ state: 'visible' });
const orphanPatch = requests.find((item) => item.method === 'PATCH' && item.path === '/admin/cohorts/co-orphan');
check('đổi tên giữ nguyên course_id mồ côi rồi canonical reload',
  JSON.parse(orphanPatch?.body || '{}').course_id === 'course-missing'
  && writeHasLaterCanonicalRead('PATCH', /^\/admin\/cohorts\/co-orphan$/)
  && await page.getByText('Lớp Liên Kết Mới', { exact: true }).count() === 1);

await page.getByRole('button', { name: 'Tạo lớp' }).first().click();
dialog = page.getByRole('dialog');
await dialog.getByLabel('Tên lớp').pressSequentially('Lớp Mới');
await dialog.getByLabel('Khóa học').selectOption('course-active');
await dialog.getByLabel('Tiền tố mã').pressSequentially('NEW');
await page.getByRole('button', { name: 'Tạo lớp' }).last().click();
await page.getByText('Đã tạo lớp.', { exact: true }).waitFor({ state: 'visible' });
check('tạo lớp POST đúng payload rồi canonical reload',
  writeHasLaterCanonicalRead('POST', /^\/admin\/cohorts$/)
  && await page.getByText('Lớp Mới', { exact: true }).count() === 1);

const activeRow = page.locator('tr').filter({ hasText: 'Lớp Nền Tảng' });
await activeRow.getByRole('button', { name: 'Lưu trữ' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Lưu trữ' }).click();
await page.getByText('Đã lưu trữ lớp.', { exact: true }).waitFor({ state: 'visible' });
check('lưu trữ mềm PATCH is_active=false rồi canonical reload',
  writeHasLaterCanonicalRead('PATCH', /^\/admin\/cohorts\/co-active$/)
  && requests.some((item) => item.path === '/admin/cohorts/co-active' && JSON.parse(item.body || '{}').is_active === false)
  && await page.getByText('Lớp Nền Tảng', { exact: true }).count() === 0);

await page.getByLabel('Trạng thái').selectOption('archived');
await page.locator('tr').filter({ hasText: 'Lớp Nền Tảng' }).getByRole('button', { name: 'Khôi phục' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Khôi phục' }).click();
await page.getByText('Đã khôi phục lớp.', { exact: true }).waitFor({ state: 'visible' });
check('khôi phục PATCH is_active=true rồi canonical reload',
  requests.some((item) => item.path === '/admin/cohorts/co-active' && JSON.parse(item.body || '{}').is_active === true)
  && requests.filter((item) => item.method === 'GET' && item.path === '/admin/cohorts').length >= 5);

check('table nằm trong viewport, overflow được giữ trong wrapper',
  await page.locator('[data-testid="classes-table-scroll"]').evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth + 1));

failCohortReads = true;
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('Không tải được danh sách lớp mới nhất', { exact: true }).waitFor({ state: 'visible' });
const failedKpis = await page.locator('.acd-kpi strong').allTextContents();
check('initial cohort failure never becomes fake zero',
  failedKpis.length === 3
  && failedKpis.every((value) => value.trim() === 'Chưa đọc được')
  && pageErrors.length === 0,
  [...failedKpis, ...pageErrors].join(' | '));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Classes native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
