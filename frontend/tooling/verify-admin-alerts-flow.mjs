// Fixture-backed browser contract for native operational alerts.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-admin-alerts-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000093';
const fakeSession = JSON.stringify({
  access_token: 'admin-alerts-not-a-real-token', refresh_token: 'x', token_type: 'bearer',
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: adminId, email: 'admin-alerts@local' },
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

const requests = [];
const unexpectedWrites = [];
let alertsRead = 0;
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
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) unexpectedWrites.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-alerts@local', role: 'admin' });
  if (parsed.pathname === '/admin/alerts') {
    alertsRead += 1;
    return json({
      session_errors: [{ id: 'session-123456789', user_id: 'user-1', user_email: '', mode: 'full_test', part: '2', error_code: 'grading_failed', error_message: 'Payload <img src=x onerror=alert(1)>', failed_step: 'admin_regrade_session', last_error_at: '2026-08-12T02:00:00Z', status: 'grading_failed' }, { missing: 'id' }],
      grading_failures: [{ id: 'response-123456789', session_id: 'session-2', user_email: 'learner@example.com', grading_status: 'failed', stt_status: 'done' }],
    });
  }
  return json({});
});

await page.goto(`${BASE}/admin/system/alerts`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Sự cố chấm bài', exact: true }).waitFor({ state: 'visible' });
await page.getByText('Payload <img src=x onerror=alert(1)>', { exact: true }).waitFor({ state: 'visible' });
check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('đọc đúng canonical limit và hiển thị hai nhóm không đếm trùng', requests.some((item) => item.path === '/admin/alerts' && item.search === '?limit=30') && await page.getByText('2', { exact: true }).count() >= 1);
check('malformed record hiển thị partial warning thay vì giả dữ liệu đầy đủ', await page.getByText(/1 bản ghi không đúng định dạng/).count() === 1);
check('payload độc hại được React escape', await page.locator('.aln-shell img, .aln-shell script, .aln-shell iframe').count() === 0);
check('identity enrichment thiếu dùng user_id chuẩn thay vì bịa email', await page.getByText('user-1', { exact: true }).count() === 1 && await page.getByText('Không lấy được danh tính', { exact: true }).count() === 0);
check('chỉ session thật tạo liên kết điều tra', await page.locator('a[href="/pages/admin/speaking/sessions.html?session=session-123456789"]').count() === 1 && await page.locator('a[href="/pages/admin/speaking/sessions.html?session=session-2"]').count() === 1);

await page.getByRole('button', { name: 'Response', exact: true }).click();
check('client filter đồng bộ URL và chỉ giữ đúng nhóm', new URL(page.url()).searchParams.get('scope') === 'grading' && await page.getByText('Response chưa chấm được', { exact: true }).count() >= 1 && await page.getByText('Payload <img src=x onerror=alert(1)>', { exact: true }).count() === 0);
await page.getByRole('button', { name: 'Làm mới', exact: true }).click();
await page.getByText(/Cập nhật/).waitFor({ state: 'visible' });
check('refresh đọc lại canonical endpoint', alertsRead >= 2);
check('mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Alerts native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
