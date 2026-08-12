// Fixture-backed browser contract for native `/admin/users`.
// It never reads or mutates production data.
//
//   node tooling/verify-admin-users-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000095';
const fakeSession = JSON.stringify({
  access_token: 'admin-users-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: adminId, email: 'admin-users@local' },
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

const users = [
  { id: 'u1', email: 'alice@example.test', display_name: 'Alice <img src=x onerror=alert(1)>', created_at: '2026-08-01T00:00:00Z', is_active: true, role: 'student', sessions_today: 2, cohort_name: null },
  { id: 'u2', email: 'bob@example.test', display_name: 'Bob', created_at: '2026-07-01T00:00:00Z', is_active: true, role: 'instructor', sessions_today: 5, cohort_name: 'Khoá 1' },
  { id: adminId, email: 'admin-users@local', display_name: 'Admin', created_at: '2026-06-01T00:00:00Z', is_active: true, role: 'admin', sessions_today: 1, cohort_name: null },
];

let codes = [
  { id: 'c1', code: 'ACTIVE-001', is_used: true, is_revoked: false, is_active: true, used_by: 'u2', used_at: '2026-07-02T00:00:00Z', created_at: '2026-07-01T00:00:00Z', permissions: ['all'], session_limit: 10, expires_at: null, code_type: 'direct', cohort_id: 'co1', cohort_name: 'Khoá 1', notes: '<script>alert(1)</script>', association_lookup_failed: false, assigned_users: [{ user_id: 'u2', name: 'Bob', email: 'bob@example.test', is_fallback_used_by: false, removable: true, quota: { used: 3, limit: 10, remaining: 7, limit_type: 'per_user_via_code' } }] },
  { id: 'c2', code: 'POOL-002', is_used: false, is_revoked: false, is_active: true, used_by: null, used_at: null, created_at: '2026-08-02T00:00:00Z', permissions: ['writing'], session_limit: null, expires_at: null, code_type: 'mass', cohort_id: null, cohort_name: null, notes: null, association_lookup_failed: true, assigned_users: [] },
  { id: 'c3', code: 'OLD-003', is_used: true, is_revoked: true, is_active: false, used_by: 'u1', used_at: '2026-06-02T00:00:00Z', created_at: '2026-06-01T00:00:00Z', permissions: ['all'], session_limit: 5, expires_at: null, code_type: 'mass', cohort_id: null, cohort_name: null, notes: null, association_lookup_failed: false, assigned_users: [] },
];

function usersPayload() {
  return users.map((user) => {
    const active = codes.filter((code) => code.is_active && !code.is_revoked && code.assigned_users.some((assigned) => assigned.user_id === user.id && assigned.removable));
    const primary = active[0];
    return {
      ...user,
      code_summary: {
        codes: active.map((code) => ({ id: code.id, code: code.code, code_type: code.code_type, permissions: code.permissions, is_active: code.is_active, created_at: code.created_at })),
        code_count: active.length,
        code_type: primary?.code_type || null,
        permissions: [...new Set(active.flatMap((code) => code.permissions))],
        has_active_code: active.length > 0,
      },
    };
  });
}

const requests = [];
const unexpectedWrites = [];
const allowedWrites = [
  /^PATCH \/admin\/users\/[^/]+\/role$/,
  /^POST \/admin\/students$/,
  /^POST \/admin\/access-codes\/(generate|generate-and-assign)$/,
  /^PATCH \/admin\/access-codes\/[^/]+$/,
  /^DELETE \/admin\/access-codes\/[^/]+$/,
  /^DELETE \/admin\/access-codes\/[^/]+\/users\/[^/]+$/,
  /^POST \/admin\/access-codes\/[^/]+\/refill$/,
  /^POST \/api\/(analytics\/events|error-logs)$/,
];
let generated = 0;
let studentCreated = false;

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
await context.addInitScript(([key, value]) => {
  try { localStorage.setItem(key, value); } catch (_) {}
}, [storageKey(SB), fakeSession]);
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
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const signature = `${method} ${parsed.pathname}`;
    if (!allowedWrites.some((pattern) => pattern.test(signature))) unexpectedWrites.push(signature);
  }

  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-users@local', role: 'admin' });
  if (parsed.pathname === '/admin/cohorts') return json({ cohorts: [{ id: 'co1', name: 'Khoá 1' }, { id: 'co2', name: 'Khoá 2' }] });
  if (parsed.pathname === '/admin/users' && method === 'GET') return json(usersPayload());
  if (parsed.pathname === '/admin/access-codes' && method === 'GET') return json(codes.map((code) => ({ ...code, assigned_user_count: code.assigned_users.length })));

  const roleMatch = parsed.pathname.match(/^\/admin\/users\/([^/]+)\/role$/);
  if (roleMatch && method === 'PATCH') {
    const body = JSON.parse(request.postData() || '{}');
    const user = users.find((item) => item.id === roleMatch[1]);
    if (user) user.role = body.role;
    return json({ ok: true, id: roleMatch[1], role: body.role });
  }
  if (parsed.pathname === '/admin/students' && method === 'POST') {
    studentCreated = true;
    return json({ id: 'student-1' });
  }
  if (parsed.pathname === '/admin/access-codes/generate-and-assign' && method === 'POST') {
    const body = JSON.parse(request.postData() || '{}');
    const code = {
      id: 'c-assigned', code: 'ASSIGNED-004', is_used: true, is_revoked: false, is_active: true,
      used_by: body.user_id, used_at: '2026-08-12T00:00:00Z', created_at: '2026-08-12T00:00:00Z',
      permissions: body.permissions, session_limit: body.session_limit, expires_at: body.expires_at,
      code_type: body.code_type, cohort_id: body.cohort_id, cohort_name: body.cohort_id === 'co1' ? 'Khoá 1' : null,
      notes: null, association_lookup_failed: false,
      assigned_users: [{ user_id: body.user_id, name: 'Alice', email: 'alice@example.test', is_fallback_used_by: false, removable: true, quota: { used: 0, limit: body.session_limit, remaining: body.session_limit, limit_type: body.session_limit == null ? 'unlimited' : 'per_user_via_code' } }],
    };
    codes = [code, ...codes];
    return json({ ok: true, user_id: body.user_id, code: code.code, code_id: code.id });
  }
  if (parsed.pathname === '/admin/access-codes/generate' && method === 'POST') {
    const body = JSON.parse(request.postData() || '{}');
    const count = Number(body.count) || 1;
    for (let index = 0; index < count; index += 1) {
      generated += 1;
      codes = [{ id: `generated-${generated}`, code: `GENERATED-${generated}`, is_used: false, is_revoked: false, is_active: true, used_by: null, used_at: null, created_at: '2026-08-12T01:00:00Z', permissions: body.permissions, session_limit: body.session_limit, expires_at: body.expires_at, code_type: body.code_type, cohort_id: body.cohort_id, cohort_name: null, notes: body.notes, association_lookup_failed: false, assigned_users: [] }, ...codes];
    }
    return json({ created: count, codes: [] });
  }
  const userRemove = parsed.pathname.match(/^\/admin\/access-codes\/([^/]+)\/users\/([^/]+)$/);
  if (userRemove && method === 'DELETE') {
    const code = codes.find((item) => item.id === userRemove[1]);
    if (code) code.assigned_users = code.assigned_users.filter((item) => item.user_id !== userRemove[2]);
    return route.fulfill({ status: 204, body: '' });
  }
  const refill = parsed.pathname.match(/^\/admin\/access-codes\/([^/]+)\/refill$/);
  if (refill && method === 'POST') {
    const source = codes.find((item) => item.id === refill[1]);
    const target = source?.used_by || 'u2';
    codes = [{ ...source, id: 'refill-1', code: 'REFILL-005', created_at: '2026-08-12T02:00:00Z', is_revoked: false, is_active: true, assigned_users: [{ user_id: target, name: 'Bob', email: 'bob@example.test', is_fallback_used_by: false, removable: true, quota: { used: 3, limit: source?.session_limit ?? null, remaining: source?.session_limit == null ? null : source.session_limit - 3, limit_type: source?.session_limit == null ? 'unlimited' : 'per_user_via_code' } }] }, ...codes];
    return json({ ok: true, user_id: target, new_code: 'REFILL-005', new_code_id: 'refill-1' });
  }
  const codeMatch = parsed.pathname.match(/^\/admin\/access-codes\/([^/]+)$/);
  if (codeMatch && method === 'PATCH') {
    const body = JSON.parse(request.postData() || '{}');
    const code = codes.find((item) => item.id === codeMatch[1]);
    if (code) Object.assign(code, body);
    return json(code || {});
  }
  if (codeMatch && method === 'DELETE') {
    const code = codes.find((item) => item.id === codeMatch[1]);
    if (code) { code.is_revoked = true; code.is_active = false; }
    return route.fulfill({ status: 204, body: '' });
  }
  return json({});
});

const writeHasLaterRead = (method, pathPattern, readPath) => {
  const index = requests.findIndex((item) => item.method === method && pathPattern.test(item.path));
  return index >= 0 && requests.slice(index + 1).some((item) => item.method === 'GET' && item.path === readPath);
};

await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' });
try { await page.getByRole('heading', { name: /Người dùng.*Mã kích hoạt/ }).waitFor({ state: 'visible' }); }
catch (error) {
  console.error('  URL:', page.url());
  console.error('  Body:', (await page.locator('body').innerText().catch(() => '')).slice(0, 1200));
  console.error('  JS:', pageErrors.join(' | '));
  throw error;
}
await page.getByText('alice@example.test', { exact: true }).waitFor({ state: 'visible' });

check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('đọc users, cohorts và số liệu canonical', ['/admin/users', '/admin/cohorts'].every((path) => requests.some((item) => item.path === path)));
check('dữ liệu độc hại được React escape', await page.locator('.au-shell img, .au-shell script').count() === 0);

await page.getByRole('tab', { name: /Người dùng/ }).focus();
await page.keyboard.press('ArrowRight');
await page.getByText('ACTIVE-001', { exact: true }).waitFor({ state: 'visible' });
check('phím mũi tên chuyển tab và focus đúng panel mã',
  await page.getByRole('tab', { name: /Mã kích hoạt/ }).evaluate((element) => document.activeElement === element)
    && await page.getByRole('tabpanel', { name: /Mã kích hoạt/ }).count() === 1);
await page.keyboard.press('ArrowLeft');
await page.getByText('alice@example.test', { exact: true }).waitFor({ state: 'visible' });
check('phím mũi tên quay lại tab người dùng',
  await page.getByRole('tab', { name: /Người dùng/ }).evaluate((element) => document.activeElement === element)
    && await page.getByRole('tabpanel', { name: /Người dùng/ }).count() === 1);

const selfRow = page.locator('tr').filter({ hasText: 'admin-users@local' });
await selfRow.locator('select').selectOption('instructor');
await page.getByRole('button', { name: 'Đổi vai trò' }).click();
await page.getByText('Không thể tự hạ quyền admin của chính mình.', { exact: true }).waitFor({ state: 'visible' });
check('tự hạ quyền fail-closed với lỗi hiển thị, không phát PATCH',
  !requests.some((item) => item.method === 'PATCH' && item.path === `/admin/users/${adminId}/role`));

const aliceRow = page.locator('tr').filter({ hasText: 'alice@example.test' });
await aliceRow.locator('select').selectOption('instructor');
await page.getByRole('button', { name: 'Đổi vai trò' }).click();
await page.getByText('Đã cập nhật vai trò thành instructor.', { exact: true }).waitFor({ state: 'visible' });
check('đổi role PATCH đúng endpoint rồi canonical reload',
  writeHasLaterRead('PATCH', /^\/admin\/users\/u1\/role$/, '/admin/users')
    && await aliceRow.getByText('instructor', { exact: true }).count() >= 1);

await aliceRow.getByRole('button', { name: 'Tạo hồ sơ HV' }).click();
await page.getByLabel('Mã học viên').fill('ALICE01');
await page.getByLabel('Họ và tên').fill('Alice Nguyễn');
await page.getByRole('button', { name: 'Tạo hồ sơ', exact: true }).click();
await page.getByText('Đã tạo hồ sơ học viên cho Alice Nguyễn.', { exact: true }).waitFor({ state: 'visible' });
check('convert học viên POST đúng contract', studentCreated && requests.some((item) => item.method === 'POST' && item.path === '/admin/students'));

await aliceRow.getByRole('button', { name: 'Tạo + gán mã' }).click();
await page.getByRole('button', { name: 'Tạo + gán mã', exact: true }).last().click();
await page.getByText(/Đã tạo và gán mã ASSIGNED-004/, { exact: false }).waitFor({ state: 'visible' });
check('generate-and-assign POST rồi canonical reload users',
  writeHasLaterRead('POST', /^\/admin\/access-codes\/generate-and-assign$/, '/admin/users')
    && await aliceRow.getByText('ASSIGNED-004', { exact: true }).count() === 1);

await page.getByRole('tab', { name: /Mã kích hoạt/ }).click();
await page.getByText('ACTIVE-001', { exact: true }).waitFor({ state: 'visible' });
check('tab mã đọc list canonical và mặc định ẩn mã revoked',
  requests.some((item) => item.path === '/admin/access-codes')
    && await page.getByText('OLD-003', { exact: true }).count() === 0);
check('association_lookup_failed hiển thị cảnh báo thật', await page.getByText('⚠ lookup failed', { exact: true }).count() === 1);
check('payload độc hại ở ghi chú không tạo script', await page.locator('.au-codes-table script').count() === 0);

let activeRow = page.locator('tr').filter({ hasText: 'ACTIVE-001' });
await activeRow.getByRole('button', { name: 'Sửa quyền' }).click();
const editDialog = page.getByRole('dialog', { name: 'Sửa quyền của mã' });
await editDialog.getByRole('button', { name: 'Đóng' }).focus();
await page.keyboard.press('Shift+Tab');
check('modal giữ focus bên trong khi Shift+Tab ở phần tử đầu', await editDialog.getByRole('button', { name: 'Lưu quyền' }).evaluate((element) => document.activeElement === element));
await page.keyboard.press('Tab');
check('modal giữ focus bên trong khi Tab ở phần tử cuối', await editDialog.getByRole('button', { name: 'Đóng' }).evaluate((element) => document.activeElement === element));
await editDialog.getByRole('checkbox', { name: 'Tất cả' }).uncheck();
await editDialog.getByRole('checkbox', { name: 'Writing' }).check();
await editDialog.getByLabel('Giới hạn lượt').fill('12');
await editDialog.getByRole('button', { name: 'Lưu quyền' }).click();
await page.getByText('Đã cập nhật quyền cho mã ACTIVE-001.', { exact: true }).waitFor({ state: 'visible' });
check('sửa quyền PATCH rồi canonical reload code list',
  writeHasLaterRead('PATCH', /^\/admin\/access-codes\/c1$/, '/admin/access-codes')
    && codes.find((item) => item.id === 'c1')?.session_limit === 12);

activeRow = page.locator('tr').filter({ hasText: 'ACTIVE-001' });
await activeRow.getByRole('button', { name: 'Gỡ' }).click();
await page.getByRole('button', { name: 'Gỡ khỏi mã' }).click();
await page.getByText('Đã gỡ người dùng khỏi mã.', { exact: true }).waitFor({ state: 'visible' });
check('gỡ user DELETE rồi canonical reload, không sửa redemption history',
  writeHasLaterRead('DELETE', /^\/admin\/access-codes\/c1\/users\/u2$/, '/admin/access-codes')
    && codes.find((item) => item.id === 'c1')?.used_by === 'u2'
    && codes.find((item) => item.id === 'c1')?.is_used === true);

activeRow = page.locator('tr').filter({ hasText: 'ACTIVE-001' });
await activeRow.getByRole('button', { name: 'Cấp mã mới' }).click();
await page.getByRole('button', { name: 'Cấp mã mới', exact: true }).last().click();
await page.getByText('Đã cấp mã mới.', { exact: true }).waitFor({ state: 'visible' });
check('refill POST tạo mã mới rồi canonical reload',
  writeHasLaterRead('POST', /^\/admin\/access-codes\/c1\/refill$/, '/admin/access-codes')
    && await page.getByText('REFILL-005', { exact: true }).count() === 1);

activeRow = page.locator('tr').filter({ hasText: 'ACTIVE-001' });
await activeRow.getByRole('button', { name: 'Thu hồi' }).click();
await page.getByRole('button', { name: 'Thu hồi', exact: true }).last().click();
await page.getByText('Đã thu hồi mã.', { exact: true }).waitFor({ state: 'visible' });
check('thu hồi DELETE rồi mã biến khỏi default view sau canonical reload',
  writeHasLaterRead('DELETE', /^\/admin\/access-codes\/c1$/, '/admin/access-codes')
    && await page.getByText('ACTIVE-001', { exact: true }).count() === 0);

await page.getByRole('button', { name: 'Tạo mã mới' }).click();
await page.getByLabel('Số lượng').fill('2');
await page.getByRole('button', { name: 'Tạo mã', exact: true }).click();
await page.getByText('Đã tạo 2 mã mới.', { exact: true }).waitFor({ state: 'visible' });
check('tạo batch POST rồi canonical reload code list',
  writeHasLaterRead('POST', /^\/admin\/access-codes\/generate$/, '/admin/access-codes')
    && await page.getByText('GENERATED-2', { exact: true }).count() === 1);

await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('revoked');
await page.getByText('OLD-003', { exact: true }).waitFor({ state: 'visible' });
check('filter revoked vẫn cho audit lịch sử', await page.getByText('ACTIVE-001', { exact: true }).count() === 1);

const desktop = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, right: document.querySelector('.au-shell')?.getBoundingClientRect().right || 0 }));
check('desktop không tràn ngang', desktop.client === desktop.scroll && desktop.right <= desktop.client);
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(100);
const mobile = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, right: document.querySelector('.au-shell')?.getBoundingClientRect().right || 0 }));
check('mobile không tràn ngang', mobile.client === mobile.scroll && mobile.right <= mobile.client);
const tableScrolls = await page.locator('[data-testid="codes-table-scroll"]').evaluate((element) => { element.scrollLeft = 80; return element.scrollWidth > element.clientWidth && element.scrollLeft > 0; });
check('bảng rộng cuộn ngang bên trong', tableScrolls);
check('không phát mutation ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
