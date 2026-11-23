// Fixture-backed browser contract for native `/admin/users` and the
// `/admin/activation-codes` ledger (ADMINIA-0074 FR-048/055).
// It never reads or mutates production data.
//
//   node tooling/verify-admin-users-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';
import { stubAdminMfaStatus } from './admin-mfa-stub.mjs';

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
  if (process.env.CHROMIUM_EXECUTABLE) return chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
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
  { id: 'u3', email: 'carol-suspended@example.test', display_name: 'Carol', created_at: '2026-05-01T00:00:00Z', is_active: false, role: 'instructor', sessions_today: 0, cohort_name: null },
];
// ADMINAAL2-0032 FR-019 (migration 336): the backend refuses a role change of
// a suspended account until it is reactivated. Carol starts suspended.
const suspended = new Set(['u3']);
const SUSPENDED_ROLE_MESSAGE = 'Không thể đổi vai trò của tài khoản đang bị tạm khóa. Hãy mở khóa tài khoản trước, rồi đổi vai trò.';

const DAY = 86_400_000;
const inDays = (days) => new Date(Date.now() + days * DAY).toISOString();
let codes = [
  { id: 'c1', code: 'ACTIVE-001', is_used: true, is_revoked: false, is_active: true, used_by: 'u2', used_at: '2026-07-02T00:00:00Z', created_at: '2026-07-01T00:00:00Z', permissions: ['all'], session_limit: 10, expires_at: null, code_type: 'direct', cohort_id: 'co1', cohort_name: 'Khoá 1', notes: '<script>alert(1)</script>', association_lookup_failed: false, assigned_users: [{ user_id: 'u2', name: 'Bob', email: 'bob@example.test', is_fallback_used_by: false, removable: true, quota: { used: 3, limit: 10, remaining: 7, limit_type: 'per_user_via_code' } }] },
  { id: 'c2', code: 'POOL-002', is_used: false, is_revoked: false, is_active: true, used_by: null, used_at: null, created_at: '2026-08-02T00:00:00Z', permissions: ['writing'], session_limit: null, expires_at: inDays(20), grant_credits: 500, code_type: 'mass', cohort_id: null, cohort_name: null, notes: null, association_lookup_failed: true, assigned_users: [] },
  { id: 'c3', code: 'OLD-003', is_used: true, is_revoked: true, is_active: false, used_by: 'u1', used_at: '2026-06-02T00:00:00Z', created_at: '2026-06-01T00:00:00Z', permissions: ['all'], session_limit: 5, expires_at: null, code_type: 'mass', cohort_id: null, cohort_name: null, notes: null, association_lookup_failed: false, assigned_users: [] },
  { id: 'c6', code: 'LATE-006', is_used: false, is_revoked: false, is_active: true, used_by: null, used_at: null, created_at: '2026-04-01T00:00:00Z', permissions: ['all'], session_limit: null, expires_at: inDays(-2), code_type: 'mass', cohort_id: null, cohort_name: null, notes: null, association_lookup_failed: false, assigned_users: [] },
  { id: 'c4', code: 'LEGACY-004', is_used: true, is_revoked: false, is_active: true, used_by: 'u1', used_at: '2026-05-02T00:00:00Z', created_at: '2026-05-01T00:00:00Z', permissions: ['all'], session_limit: 5, expires_at: null, code_type: 'mass', cohort_id: null, cohort_name: null, notes: null, association_lookup_failed: false, assigned_users: [{ user_id: 'u1', name: 'Alice', email: 'alice@example.test', is_fallback_used_by: true, removable: false, quota: { used: 2, limit: 5, remaining: 3, limit_type: 'per_user_via_code' } }] },
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
  /^POST \/admin\/access-codes\/generate-and-assign$/,
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
  if (parsed.pathname === '/admin/settings/thresholds' && method === 'GET') {
    return json({ items: [{ key: 'code_expiring_days', group: 'expiring', label: 'Mã kích hoạt chưa dùng', anchor: '', value: 30, unit: 'ngày', min: 1, max: 90, fixed: false }] });
  }
  if (parsed.pathname === '/admin/access-codes' && method === 'GET') return json(codes.map((code) => ({ ...code, assigned_user_count: code.assigned_users.length })));

  const roleMatch = parsed.pathname.match(/^\/admin\/users\/([^/]+)\/role$/);
  if (roleMatch && method === 'PATCH') {
    const body = JSON.parse(request.postData() || '{}');
    const user = users.find((item) => item.id === roleMatch[1]);
    if (user && suspended.has(user.id) && body.role !== user.role) {
      return json({ detail: { code: 'account_suspended_role_change', message: SUSPENDED_ROLE_MESSAGE } }, 409);
    }
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
await stubAdminMfaStatus(page);

const writeHasLaterRead = (method, pathPattern, readPath) => {
  const index = requests.findIndex((item) => item.method === method && pathPattern.test(item.path));
  return index >= 0 && requests.slice(index + 1).some((item) => item.method === 'GET' && item.path === readPath);
};

await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' });
try { await page.getByRole('heading', { name: 'Người dùng', exact: true }).waitFor({ state: 'visible' }); }
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

check('trang người dùng không còn tab mã, có link sang sổ mã',
  await page.getByRole('tab').count() === 0
    && await page.getByRole('link', { name: 'Mở sổ tra cứu mã kích hoạt' }).getAttribute('href') === '/admin/activation-codes');

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

const carolRow = page.locator('tr').filter({ hasText: 'carol-suspended@example.test' });
await carolRow.locator('select').selectOption('student');
await page.getByRole('button', { name: 'Đổi vai trò' }).click();
await page.getByRole('alert').filter({ hasText: SUSPENDED_ROLE_MESSAGE }).waitFor({ state: 'visible' });
check('đổi role tài khoản đang tạm khóa: 409 hiện lỗi tiếng Việt, role giữ nguyên',
  requests.some((item) => item.method === 'PATCH' && item.path === '/admin/users/u3/role')
    && users.find((item) => item.id === 'u3').role === 'instructor'
    && await carolRow.locator('select').inputValue() === 'instructor');
suspended.delete('u3');   // the admin reactivates the account first (PATCH …/active)
const carolRetryFrom = requests.length;
await carolRow.locator('select').selectOption('student');
await page.getByRole('button', { name: 'Đổi vai trò' }).click();
await page.getByText('Đã cập nhật vai trò thành student.', { exact: true }).waitFor({ state: 'visible' });
const carolRetry = requests.slice(carolRetryFrom);
const carolPatch = carolRetry.findIndex((item) => item.method === 'PATCH' && item.path === '/admin/users/u3/role');
check('sau khi mở khóa, đổi role thành công rồi canonical reload',
  carolPatch >= 0 && carolRetry.slice(carolPatch + 1).some((item) => item.method === 'GET' && item.path === '/admin/users')
    && await carolRow.locator('select').inputValue() === 'student');

await aliceRow.getByRole('button', { name: 'Tạo hồ sơ HV' }).click();
await page.getByLabel('Mã học viên').fill('');
await page.getByLabel('Mã học viên').pressSequentially('ALICE01');
await page.getByLabel('Họ và tên').fill('');
await page.getByLabel('Họ và tên').pressSequentially('Alice Nguyen');
check('controlled modal giữ focus qua nhiều ký tự',
  await page.getByLabel('Mã học viên').inputValue() === 'ALICE01'
    && await page.getByLabel('Họ và tên').inputValue() === 'Alice Nguyen');
await page.getByRole('button', { name: 'Tạo hồ sơ', exact: true }).click();
await page.getByText('Đã tạo hồ sơ học viên cho Alice Nguyen.', { exact: true }).waitFor({ state: 'visible' });
check('convert học viên POST đúng contract', studentCreated && requests.some((item) => item.method === 'POST' && item.path === '/admin/students'));

await aliceRow.getByRole('button', { name: 'Tạo + gán mã' }).click();
await page.getByRole('button', { name: 'Tạo + gán mã', exact: true }).last().click();
await page.getByText(/Đã tạo và gán mã ASSIGNED-004/, { exact: false }).waitFor({ state: 'visible' });
check('generate-and-assign POST rồi canonical reload users',
  writeHasLaterRead('POST', /^\/admin\/access-codes\/generate-and-assign$/, '/admin/users')
    && await aliceRow.getByText('ASSIGNED-004', { exact: true }).count() === 1);

// ADMINIA-0074 FR-048: both old doors land on the ledger.
for (const legacy of ['/admin/users?tab=codes', '/admin/access-codes']) {
  const response = await page.request.get(`${BASE}${legacy}`, { maxRedirects: 0 });
  const location = response.headers().location || '';
  check(`${legacy} chuyển hướng ${legacy.includes('?') ? '307' : '308'} tới sổ mã`,
    response.status() === (legacy.includes('?') ? 307 : 308) && new URL(location, BASE).pathname === '/admin/activation-codes',
    `${response.status()} ${location}`);
}
const noCreate = await page.request.get(`${BASE}/admin/activation-codes/new`, { maxRedirects: 0 });
check('không có trang /admin/activation-codes/new', noCreate.status() === 404, String(noCreate.status()));

await page.goto(`${BASE}/admin/users?tab=codes`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /Mã kích hoạt/ }).waitFor({ state: 'visible' });
await page.getByText('ACTIVE-001', { exact: true }).waitFor({ state: 'visible' });
check('mở sổ mã qua đường cũ, đọc list canonical và ngưỡng',
  new URL(page.url()).pathname === '/admin/activation-codes'
    && requests.some((item) => item.path === '/admin/access-codes')
    && requests.some((item) => item.path === '/admin/settings/thresholds'));
check('sổ mã không có form tạo mã', await page.getByRole('button', { name: 'Tạo mã mới' }).count() === 0);
check('sổ mặc định hiện cả mã đã thu hồi', await page.getByText('OLD-003', { exact: true }).count() === 1);
check('association_lookup_failed hiển thị cảnh báo thật', await page.getByText('⚠ lookup failed', { exact: true }).count() === 1);
check('payload độc hại ở ghi chú không tạo script', await page.locator('.au-codes-table script').count() === 0);

const stateOf = (code) => page.locator('tr').filter({ hasText: code }).locator('[data-ledger-state]');
check('trạng thái sổ: Chưa dùng · Đã dùng (ngày) · Hết hạn nhập · Đã thu hồi',
  await stateOf('POOL-002').getAttribute('data-ledger-state') === 'unused'
    && await stateOf('ACTIVE-001').getAttribute('data-ledger-state') === 'used'
    && /ngày 0?2\/0?7\/2026/.test(await stateOf('ACTIVE-001').innerText())
    && await stateOf('LATE-006').getAttribute('data-ledger-state') === 'expired'
    && await stateOf('OLD-003').getAttribute('data-ledger-state') === 'revoked');
check('nhãn sắp hết hạn theo code_expiring_days (30 ngày)',
  await page.locator('tr').filter({ hasText: 'POOL-002' }).getByTestId('code-expiring').count() === 1
    && await page.getByTestId('code-expiring').count() === 1);
check('cột Số lượt chấm cấp kèm mã: có số hoặc "chưa có"',
  await page.getByRole('columnheader', { name: 'Số lượt chấm cấp kèm mã' }).count() === 1
    && await page.locator('tr').filter({ hasText: 'POOL-002' }).getByText(/^500 lượt$/).count() === 1
    && await page.locator('tr').filter({ hasText: 'LATE-006' }).getByText('chưa có', { exact: true }).count() === 1);

const openMenu = async (code) => {
  await page.locator('tr').filter({ hasText: code }).getByRole('button', { name: `Thao tác khác với mã ${code}` }).click();
  const menu = page.getByRole('menu', { name: `Thao tác khác với mã ${code}` });
  await menu.waitFor({ state: 'visible' });
  return menu;
};

let menu = await openMenu('ACTIVE-001');
const items = await menu.getByRole('menuitem').allInnerTexts();
check('menu ⋯: Thu hồi là mục cuối; mã đang dùng không thu hồi được',
  /^Thu hồi mã/.test(items.at(-1) || '')
    && await menu.getByRole('menuitem', { name: /Thu hồi mã/ }).getAttribute('aria-disabled') === 'true',
  items.join(' | '));
check('menu ⋯ focus mục đầu khi mở', await menu.getByRole('menuitem').first().evaluate((element) => document.activeElement === element));
await page.keyboard.press('Escape');
check('Esc đóng menu và trả focus về nút ⋯',
  await page.getByRole('menu').count() === 0
    && await page.getByRole('button', { name: 'Thao tác khác với mã ACTIVE-001' }).evaluate((element) => document.activeElement === element));

const legacyRow = page.locator('tr').filter({ hasText: 'LEGACY-004' });
check('fallback owner chỉ là lịch sử, không có nút gỡ',
  await legacyRow.getByText('lịch sử kích hoạt', { exact: true }).count() === 1
    && await legacyRow.getByRole('button', { name: 'Gỡ', exact: true }).count() === 0);
menu = await openMenu('LEGACY-004');
check('fallback-only code vẫn cho thu hồi', await menu.getByRole('menuitem', { name: /Thu hồi mã/ }).getAttribute('aria-disabled') === null);
await menu.getByRole('menuitem', { name: /Thu hồi mã/ }).click();
await page.getByRole('button', { name: 'Thu hồi', exact: true }).last().click();
await page.getByText('Đã thu hồi mã.', { exact: true }).waitFor({ state: 'visible' });
check('fallback-only code thu hồi qua backend rồi canonical reload',
  writeHasLaterRead('DELETE', /^\/admin\/access-codes\/c4$/, '/admin/access-codes')
    && await stateOf('LEGACY-004').getAttribute('data-ledger-state') === 'revoked');

menu = await openMenu('ACTIVE-001');
await menu.getByRole('menuitem', { name: 'Sửa quyền' }).click();
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

let activeRow = page.locator('tr').filter({ hasText: 'ACTIVE-001' });
await activeRow.getByRole('button', { name: 'Gỡ' }).click();
await page.getByRole('button', { name: 'Gỡ khỏi mã' }).click();
await page.getByText('Đã gỡ người dùng khỏi mã.', { exact: true }).waitFor({ state: 'visible' });
check('gỡ user DELETE rồi canonical reload, không sửa redemption history',
  writeHasLaterRead('DELETE', /^\/admin\/access-codes\/c1\/users\/u2$/, '/admin/access-codes')
    && codes.find((item) => item.id === 'c1')?.used_by === 'u2'
    && codes.find((item) => item.id === 'c1')?.is_used === true);

menu = await openMenu('ACTIVE-001');
await menu.getByRole('menuitem', { name: 'Cấp mã mới' }).click();
await page.getByRole('button', { name: 'Cấp mã mới', exact: true }).last().click();
await page.getByText('Đã cấp mã mới.', { exact: true }).waitFor({ state: 'visible' });
check('refill POST tạo mã mới rồi canonical reload',
  writeHasLaterRead('POST', /^\/admin\/access-codes\/c1\/refill$/, '/admin/access-codes')
    && await page.getByText('REFILL-005', { exact: true }).count() === 1);

menu = await openMenu('ACTIVE-001');
await menu.getByRole('menuitem', { name: /Thu hồi mã/ }).click();
await page.getByRole('button', { name: 'Thu hồi', exact: true }).last().click();
await page.getByText('Đã thu hồi mã.', { exact: true }).waitFor({ state: 'visible' });
check('thu hồi DELETE rồi sổ hiện Đã thu hồi sau canonical reload',
  writeHasLaterRead('DELETE', /^\/admin\/access-codes\/c1$/, '/admin/access-codes')
    && await stateOf('ACTIVE-001').getAttribute('data-ledger-state') === 'revoked');

await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('expired');
await page.getByText('LATE-006', { exact: true }).waitFor({ state: 'visible' });
check('lọc Hết hạn nhập chỉ còn mã quá hạn chưa dùng',
  await page.locator('[data-ledger-state]').count() === 1);
await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('revoked');
await page.getByText('OLD-003', { exact: true }).waitFor({ state: 'visible' });
check('filter revoked vẫn cho audit lịch sử', await page.getByText('ACTIVE-001', { exact: true }).count() === 1);
await page.getByRole('combobox', { name: 'Trạng thái', exact: true }).selectOption('');

const desktop = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, right: document.querySelector('.au-shell')?.getBoundingClientRect().right || 0 }));
check('desktop không tràn ngang', desktop.client === desktop.scroll && desktop.right <= desktop.client);
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(100);
const mobile = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, right: document.querySelector('.au-shell')?.getBoundingClientRect().right || 0 }));
check('mobile không tràn ngang', mobile.client === mobile.scroll && mobile.right <= mobile.client);
const tableScrolls = await page.locator('[data-testid="codes-table-scroll"]').evaluate((element) => { element.scrollLeft = 80; return element.scrollWidth > element.clientWidth && element.scrollLeft > 0; });
check('bảng rộng cuộn ngang bên trong', tableScrolls);
await page.setViewportSize({ width: 1365, height: 900 });
await page.route(`${BASE}/admin/classes/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>class</title>' }));
await page.getByRole('button', { name: 'Tạo mã cho một lớp' }).click();
const classDialog = page.getByRole('dialog', { name: 'Tạo mã cho một lớp' });
await classDialog.getByRole('button', { name: 'Mở trang lớp' }).click();
check('chưa chọn lớp thì báo lỗi, không rời trang', await classDialog.getByRole('alert').innerText() === 'Chọn một lớp trước.');
await classDialog.getByLabel('Lớp').selectOption('co2');
await Promise.all([
  page.waitForURL(`${BASE}/admin/classes/co2`),
  classDialog.getByRole('button', { name: 'Mở trang lớp' }).click(),
]);
check('Tạo mã cho một lớp → chọn lớp → mở trang lớp (tạm thời, chờ T029)', new URL(page.url()).pathname === '/admin/classes/co2');
check('không phát mutation ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
