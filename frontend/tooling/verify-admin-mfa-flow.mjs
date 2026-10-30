// ADMINAAL2-0032 T010 — fixture-backed browser contract for the admin MFA gate
// and /admin/mfa. Every API call and every Supabase Auth (GoTrue) MFA endpoint
// is intercepted; no real account, factor or database is touched.
//
//   node tooling/verify-admin-mfa-flow.mjs [base]
//
// The fixture derives the session assurance from the bearer token, the way the
// backend reads the `aal` claim: `aal2-token` (what the stubbed verify returns)
// is AAL2, anything else AAL1.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { stubAdminMfaStatus } from './admin-mfa-stub.mjs';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000132';
const email = 'admin-mfa@local';
const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="black"/></svg>';
const SECRET = 'JBSWY3DPEHPK3PXP';
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

function sessionFor(token) {
  return JSON.stringify({
    access_token: token, refresh_token: 'x', token_type: 'bearer',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: adminId, email },
  });
}

const factor = (id, status, name = 'Ứng dụng xác thực') => ({
  id, factor_type: 'totp', status, friendly_name: name,
  created_at: '2026-10-20T03:00:00Z', updated_at: '2026-10-20T03:00:00Z',
});

const browser = await launchChromium();

/**
 * One isolated browser context per scenario.
 * state.verify: queue of 'wrong' | 'rate' | 'ok' outcomes for POST …/verify.
 */
async function scenario(name, options, run) {
  console.log(`\n${name}`);
  const state = {
    role: 'admin', isActive: true, enforce: true, token: 'aal1-token',
    factors: [], verify: [], adminUsers: null, ...options,
    requests: [], unexpectedWrites: [], pageErrors: [],
  };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Seed the session once: after a verify the shared client stores the AAL2
  // session, and a reload must keep it.
  await context.addInitScript(([key, value]) => {
    try { if (!localStorage.getItem(key)) localStorage.setItem(key, value); } catch (_) {}
  }, [storageKey(SB), sessionFor(state.token)]);
  const page = await context.newPage();
  page.on('pageerror', (error) => state.pageErrors.push(String(error)));
  let challengeSeq = 0;

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
    if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
    const parsed = new URL(url);
    const method = request.method();
    const auth = request.headers().authorization || '';
    state.requests.push({ method, path: parsed.pathname, search: parsed.search, auth });
    const json = (body, status = 200) => route.fulfill({
      status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': request.headers().origin || '*' },
      body: JSON.stringify(body),
    });
    const goTrueError = (status, code, message) => json({ code, error_code: code, msg: message, message }, status);

    // Supabase Auth (GoTrue) MFA endpoints.
    if (parsed.pathname === '/auth/v1/user' && method === 'GET') {
      return json({ id: adminId, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', factors: state.factors });
    }
    if (parsed.pathname === '/auth/v1/factors' && method === 'POST') {
      const body = request.postDataJSON() || {};
      const created = factor(`factor-new-${state.factors.length + 1}`, 'unverified', body.friendly_name);
      state.factors.push(created);
      return json({ id: created.id, type: 'totp', friendly_name: created.friendly_name, totp: { qr_code: QR_SVG, secret: SECRET, uri: `otpauth://totp/Aver:${email}?secret=${SECRET}` } });
    }
    const factorPath = parsed.pathname.match(/^\/auth\/v1\/factors\/([^/]+)(\/challenge|\/verify)?$/);
    if (factorPath) {
      const [, id, action] = factorPath;
      if (method === 'DELETE' && !action) {
        state.factors = state.factors.filter((item) => item.id !== id);
        return json({ id });
      }
      if (method === 'POST' && action === '/challenge') {
        challengeSeq += 1;
        return json({ id: `challenge-${challengeSeq}`, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
      }
      if (method === 'POST' && action === '/verify') {
        const outcome = state.verify.shift() || 'wrong';
        if (outcome === 'rate') return goTrueError(429, 'over_request_rate_limit', 'Too many requests');
        if (outcome === 'wrong') return goTrueError(422, 'mfa_verification_failed', 'Invalid TOTP code entered');
        state.factors = state.factors.map((item) => (item.id === id ? { ...item, status: 'verified' } : item));
        return json({ access_token: 'aal2-token', token_type: 'bearer', expires_in: 3600, refresh_token: 'r2', user: { id: adminId, email, factors: state.factors } });
      }
    }
    if (parsed.pathname.startsWith('/auth/v1/')) return json({});

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) {
      state.unexpectedWrites.push(`${method} ${parsed.pathname}`);
    }
    if (parsed.pathname === '/auth/me') return json({ id: adminId, email, role: state.role, is_active: state.isActive });
    if (parsed.pathname === '/auth/check-active') return json({ is_active: state.isActive, suspended: false });
    if (parsed.pathname === '/admin/users' && state.adminUsersQueue?.length) {
      const next = state.adminUsersQueue.shift();
      return json(next.body, next.status);
    }
    if (parsed.pathname === '/admin/users' && state.adminUsers) return json(state.adminUsers.body, state.adminUsers.status);
    return json({});
  });
  await stubAdminMfaStatus(page, (request) => {
    const aal = (request.headers().authorization || '') === 'Bearer aal2-token' ? 'aal2' : 'aal1';
    const verified = state.factors.filter((item) => item.status === 'verified').length;
    state.requests.push({ method: 'GET', path: '/admin/mfa/status', search: '', auth: request.headers().authorization || '' });
    return { aal, enforce: state.enforce, verified_factor_count: verified, next_step: aal === 'aal2' ? 'none' : verified ? 'challenge' : 'enroll' };
  });

  try {
    await run(page, state);
  } catch (error) {
    check(`${name}: kịch bản chạy hết`, false, String(error).split('\n')[0]);
  }
  check(`${name}: không có write ngoài contract`, state.unexpectedWrites.length === 0, state.unexpectedWrites.join(', '));
  check(`${name}: không có lỗi JS`, state.pageErrors.length === 0, state.pageErrors.join(' | '));
  await context.close();
}

const pathOf = (page) => { const url = new URL(page.url()); return `${url.pathname}${url.search}`; };

await scenario('Enforced AAL1 → /admin/mfa → enroll', {
  factors: [factor('factor-abandoned', 'unverified')],
  verify: ['wrong', 'ok'],
}, async (page, state) => {
  await page.goto(`${BASE}/admin/users?tab=codes`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => url.pathname === '/admin/mfa');
  check('gate chuyển admin AAL1 sang /admin/mfa kèm next', pathOf(page) === '/admin/mfa?next=%2Fadmin%2Fusers%3Ftab%3Dcodes', pathOf(page));
  check('trang admin không đọc dữ liệu khi chưa AAL2', !state.requests.some((item) => item.path === '/admin/users' || item.path === '/admin/access-codes'));
  const start = page.getByRole('button', { name: 'Bắt đầu thiết lập' });
  await start.waitFor({ state: 'visible' });
  check('focus bắt đầu ở hành động chính', await start.evaluate((element) => element === document.activeElement));
  await start.click();
  const qr = page.getByRole('img', { name: 'Mã QR thiết lập xác thực 2 bước' });
  await qr.waitFor({ state: 'visible' });
  const deleteAt = state.requests.findIndex((item) => item.method === 'DELETE' && item.path === '/auth/v1/factors/factor-abandoned');
  const enrollAt = state.requests.findIndex((item) => item.method === 'POST' && item.path === '/auth/v1/factors');
  check('factor bỏ dở được gỡ trước khi enroll mới', deleteAt >= 0 && enrollAt > deleteAt, `${deleteAt} < ${enrollAt}`);
  const box = await qr.boundingBox();
  check('QR tối thiểu 192 px', Boolean(box && box.width >= 192 && box.height >= 192), JSON.stringify(box));
  check('khóa bí mật dạng chữ để sao chép', await page.getByText(SECRET, { exact: true }).count() === 1);
  const input = page.getByLabel('Mã 6 số từ ứng dụng');
  check('ô mã numeric + one-time-code', await input.getAttribute('inputmode') === 'numeric' && await input.getAttribute('autocomplete') === 'one-time-code');
  check('mobile 390 không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await input.fill('000000');
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await page.getByText('Mã không đúng hoặc đã hết hạn — thử lại').waitFor({ state: 'visible' });
  check('mã sai: xoá ô và focus lại', await input.inputValue() === '' && await input.evaluate((element) => element === document.activeElement));
  check('lỗi nằm trong vùng aria-live assertive', await page.locator('[aria-live="assertive"]', { hasText: 'Mã không đúng' }).count() === 1);
  await input.fill('123456');
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await page.waitForURL((url) => url.pathname === '/admin/users');
  check('xác thực xong quay về next đã làm sạch', pathOf(page) === '/admin/users?tab=codes', pathOf(page));
  await page.waitForFunction(() => !document.getElementById('state-loading'));
  const statusCalls = state.requests.filter((item) => item.path === '/admin/mfa/status');
  check('phiên mới (AAL2) của client dùng chung được gửi tới backend', statusCalls.at(-1)?.auth === 'Bearer aal2-token', statusCalls.at(-1)?.auth);
  check('AAL2 vào được trang admin, không bị chuyển lại', new URL(page.url()).pathname === '/admin/users' && await page.locator('#state-mfa-redirect').count() === 0);
});

await scenario('Report-only AAL1 → banner', { enforce: false, factors: [] }, async (page) => {
  await page.goto(`${BASE}/admin/system`, { waitUntil: 'domcontentloaded' });
  const banner = page.locator('#admin-mfa-report-only');
  await banner.waitFor({ state: 'visible' });
  check('banner report-only role=status, chữ tiếng Việt', await banner.getAttribute('role') === 'status' && (await banner.textContent()).includes('Hãy bật xác thực 2 bước — sắp bắt buộc'));
  check('banner trỏ tới /admin/mfa?next=/admin/system', await banner.getByRole('link').getAttribute('href') === '/admin/mfa?next=%2Fadmin%2Fsystem');
  check('report-only vẫn render trang admin', await page.getByRole('heading', { name: 'Hệ thống', exact: true }).count() === 1);
  await banner.getByRole('button', { name: 'Ẩn' }).click();
  check('ẩn banner', await banner.count() === 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Hệ thống', exact: true }).waitFor({ state: 'visible' });
  check('ẩn trong cùng tab vẫn giữ sau khi tải lại', await page.locator('#admin-mfa-report-only').count() === 0);
});

await scenario('Challenge: 429, rồi next ngoài /admin bị loại', {
  factors: [factor('factor-main', 'verified')],
  verify: ['rate', 'ok'],
}, async (page) => {
  await page.goto(`${BASE}/admin/mfa?next=${encodeURIComponent('https://evil.test/admin/users')}`, { waitUntil: 'domcontentloaded' });
  const input = page.getByLabel('Mã 6 số', { exact: true });
  await input.waitFor({ state: 'visible' });
  check('phiên AAL1 có factor → màn challenge', await page.getByRole('heading', { name: 'Nhập mã xác thực' }).count() === 1);
  await input.fill('123456');
  await page.getByRole('button', { name: 'Xác thực' }).click();
  await page.getByText('Thử quá nhiều lần — đợi một lát rồi thử lại').waitFor({ state: 'visible' });
  check('429: nút gửi bị khoá dù mã đủ 6 số', await page.getByRole('button', { name: 'Xác thực' }).isDisabled());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await input.waitFor({ state: 'visible' });
  await input.fill('123456');
  await page.getByRole('button', { name: 'Xác thực' }).click();
  await page.waitForURL((url) => url.pathname === '/admin');
  check('next ngoài site quay về /admin', pathOf(page) === '/admin', pathOf(page));
});

await scenario('Manage AAL2: gỡ factor cuối cần mã mới', {
  token: 'aal2-token',
  factors: [factor('factor-main', 'verified')],
  verify: ['ok'],
}, async (page, state) => {
  await page.goto(`${BASE}/admin/mfa`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Yếu tố xác thực' }).waitFor({ state: 'visible' });
  check('một factor → cảnh báo thêm dự phòng', await page.getByText('Nên thêm một yếu tố dự phòng lưu ngoại tuyến').count() === 1);
  check('có nút thêm yếu tố dự phòng', await page.getByRole('button', { name: 'Thêm yếu tố dự phòng' }).count() === 1);
  const remove = page.getByRole('button', { name: 'Gỡ', exact: true });
  await remove.click();
  const dialog = page.getByRole('dialog', { name: 'Gỡ yếu tố xác thực' });
  await dialog.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  check('Escape đóng dialog và trả focus về nút Gỡ', await remove.evaluate((element) => element === document.activeElement));
  check('đóng dialog không gỡ gì', !state.requests.some((item) => item.method === 'DELETE'));
  await remove.click();
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByLabel('Mã 6 số').fill('123456');
  await dialog.getByRole('button', { name: 'Gỡ yếu tố' }).click();
  await page.getByText('Lần đăng nhập sau sẽ phải thiết lập lại').waitFor({ state: 'visible' });
  const verifyAt = state.requests.findIndex((item) => item.path === '/auth/v1/factors/factor-main/verify');
  const deleteAt = state.requests.findIndex((item) => item.method === 'DELETE' && item.path === '/auth/v1/factors/factor-main');
  const refetchAt = state.requests.findLastIndex((item) => item.path === '/auth/v1/user');
  check('gỡ chỉ sau khi mã mới được xác minh, rồi đọc lại danh sách', verifyAt >= 0 && deleteAt > verifyAt && refetchAt > deleteAt, `${verifyAt} < ${deleteAt} < ${refetchAt}`);
});

await scenario('Transport: mfa_required sau khi trang đã tải', {
  token: 'aal2-token',
  factors: [factor('factor-main', 'verified')],
  adminUsers: { status: 403, body: { detail: { code: 'mfa_required', next_step: 'challenge', message: 'Cần xác thực 2 bước để dùng quyền admin.' } } },
}, async (page) => {
  await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => url.pathname === '/admin/mfa');
  check('api.js chuyển 403 mfa_required sang /admin/mfa?next=<path>', pathOf(page) === '/admin/mfa?next=%2Fadmin%2Fusers', pathOf(page));
});

// PR #2023 Codex P1: the step-up prompt opens on whatever admin page made the
// refused call. /admin/users' layout lists only its own CSS, so the prompt must
// bring its stylesheet itself. Loaded directly, never via /admin/mfa.
await scenario('Step-up trên /admin/users vào thẳng: hộp thoại có style', {
  token: 'aal2-token',
  factors: [factor('factor-main', 'verified')],
  verify: ['ok'],
  adminUsersQueue: [
    { status: 403, body: { detail: { code: 'step_up_required', next_step: 'challenge', max_age_seconds: 900, message: 'Thao tác này cần nhập lại mã xác thực 2 bước.' } } },
    { status: 200, body: [] },
  ],
}, async (page, state) => {
  await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Xác thực 2 bước' });
  await dialog.waitFor({ state: 'visible' });
  const input = dialog.getByLabel('Mã 6 số', { exact: true });
  await input.waitFor({ state: 'visible' });
  check('vào thẳng /admin/users, không qua /admin/mfa', pathOf(page) === '/admin/users' && !state.requests.some((item) => item.path === '/admin/mfa'), pathOf(page));
  await page.waitForFunction((href) => [...document.styleSheets].some((sheet) => sheet.href && new URL(sheet.href).pathname === href), '/css/admin-mfa-dialog.css', { timeout: 10000 })
    .then(() => check('stylesheet hộp thoại được nạp trên trang không liệt kê nó', true))
    .catch(() => check('stylesheet hộp thoại được nạp trên trang không liệt kê nó', false));
  const styles = await dialog.evaluate((panel) => {
    const backdrop = panel.parentElement;
    const b = getComputedStyle(backdrop);
    const p = getComputedStyle(panel);
    const rect = panel.getBoundingClientRect();
    const field = panel.querySelector('input');
    return {
      backdrop: { position: b.position, zIndex: b.zIndex, top: b.top, left: b.left, width: backdrop.getBoundingClientRect().width, background: b.backgroundColor },
      panel: { background: p.backgroundColor, radius: p.borderTopLeftRadius, borderStyle: p.borderTopStyle, display: p.display },
      input: field ? getComputedStyle(field).minHeight : null,
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollWidth: document.documentElement.scrollWidth },
    };
  });
  check('backdrop phủ cố định toàn màn hình (position fixed, z-index 1200, inset 0)',
    styles.backdrop.position === 'fixed' && styles.backdrop.zIndex === '1200' && styles.backdrop.top === '0px' && styles.backdrop.left === '0px'
      && Math.round(styles.backdrop.width) === styles.viewport.width && styles.backdrop.background !== 'rgba(0, 0, 0, 0)', JSON.stringify(styles.backdrop));
  check('panel có nền, viền và bo góc', styles.panel.background !== 'rgba(0, 0, 0, 0)' && styles.panel.radius !== '0px' && styles.panel.borderStyle === 'solid' && styles.panel.display === 'grid', JSON.stringify(styles.panel));
  check('ô mã cao tối thiểu 44 px', styles.input === '44px', String(styles.input));
  check('mobile 390: panel nằm trong màn hình, không tràn ngang',
    styles.rect.left >= 0 && styles.rect.right <= styles.viewport.width + 0.5 && styles.rect.bottom <= styles.viewport.height + 0.5
      && styles.viewport.scrollWidth <= styles.viewport.width, JSON.stringify({ ...styles.rect, ...styles.viewport }));
  const focusStaysInside = async (key) => {
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press(key);
      if (!await dialog.evaluate((panel) => panel.contains(document.activeElement))) return false;
    }
    return true;
  };
  check('Tab và Shift+Tab giữ focus trong hộp thoại', await focusStaysInside('Tab') && await focusStaysInside('Shift+Tab'));
  await page.setViewportSize({ width: 1280, height: 800 });
  const desktop = await dialog.evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    return { width: rect.width, center: rect.left + rect.width / 2, viewport: window.innerWidth };
  });
  check('desktop: panel rộng tối đa 480 px, ở giữa', desktop.width <= 480.5 && Math.abs(desktop.center - desktop.viewport / 2) <= 1, JSON.stringify(desktop));
  await input.fill('123456');
  await dialog.getByRole('button', { name: 'Xác thực' }).click();
  await dialog.waitFor({ state: 'detached' });
  const reads = state.requests.filter((item) => item.method === 'GET' && item.path === '/admin/users');
  check('mã đúng: đóng hộp thoại và gửi lại đúng một lần', reads.length === 2 && pathOf(page) === '/admin/users', String(reads.length));
});

await scenario('/admin/mfa từ chối non-admin', { role: 'user' }, async (page, state) => {
  await page.goto(`${BASE}/admin/mfa`, { waitUntil: 'domcontentloaded' });
  await page.getByText('🔒 Admin Access Required').waitFor({ state: 'visible' });
  check('non-admin thấy trạng thái bị từ chối, có link về /home', await page.locator('#state-denied a[href="/home"]').count() === 1);
  check('non-admin không đọc trạng thái MFA hay factor', !state.requests.some((item) => item.path === '/admin/mfa/status' || item.path === '/auth/v1/user'));
});

await scenario('Gate từ chối admin không hoạt động', { isActive: false }, async (page) => {
  // The phase-0 activation redirect (W-03) normally sends this account to
  // /login first; answer check-active as active to reach the gate itself.
  await page.route((url) => url.pathname === '/auth/check-active', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin || '*' },
    body: JSON.stringify({ is_active: true, suspended: false }),
  }));
  await page.goto(`${BASE}/admin/system`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Tài khoản chưa được kích hoạt — liên hệ admin').waitFor({ state: 'visible' });
  check('admin không hoạt động: denied + thông báo, không render trang', await page.getByRole('heading', { name: 'Hệ thống', exact: true }).count() === 0);
});

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin MFA native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
