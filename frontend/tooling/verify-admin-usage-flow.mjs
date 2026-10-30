// Fixture-backed browser contract for native user/code activity rollups.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-admin-usage-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000094';
const fakeSession = JSON.stringify({ access_token: 'admin-usage-not-a-real-token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-usage@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launchChromium() { try { return await chromium.launch(); } catch (error) { const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome }); throw error; } }

const requests = [];
const unexpectedWrites = [];
let userReads = 0;
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-usage@local', role: 'admin' });
  if (parsed.pathname === '/admin/usage/users') {
    userReads += 1;
    if (userReads > 1) return json({ detail: 'usage source unavailable' }, 503);
    return json([
      { user_id: 'user-1', email: 'learner<img src=x>@example.com', name: 'An <script>alert(1)</script>', role: 'student', sessions: 9, last_active: '2026-08-12T08:00:00Z', ai_cost_usd: 1.25 },
      { user_id: 'user-2', email: 'binh@example.com', name: 'Bình', role: 'student', sessions: null, last_active: null, ai_cost_usd: null },
      { user_id: 'user-1', email: 'duplicate@example.com', sessions: 99, last_active: null, ai_cost_usd: 9 },
      { user_id: '', sessions: 1, last_active: null, ai_cost_usd: 0 },
    ]);
  }
  if (parsed.pathname === '/admin/access-codes/code%2Fwith%20space/usage') {
    return json({
      code: { id: 'code/with space', code: 'COURSE-1', session_limit: 20, code_type: 'direct', cohort_id: 'cohort-1' },
      assigned_users: [{ user_id: 'user-1', email: 'learner@example.com', name: 'An', sessions: null, last_active: null, ai_cost_usd: 0.5 }],
      aggregate: { assigned_user_count: 1, total_sessions: null, total_ai_cost_usd: 0.5 },
    });
  }
  return json({});
});

await page.goto(`${BASE}/admin/usage?q=learner&sort=name`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Hoạt động người dùng', exact: true }).waitFor({ state: 'visible' });
await page.getByText('An <script>alert(1)</script>', { exact: true }).waitFor({ state: 'visible' });
check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('global view đọc đúng endpoint canonical', requests.filter((item) => item.path === '/admin/usage/users').length === 1);
check('search và sort khôi phục từ URL', await page.getByLabel('Tìm người dùng').inputValue() === 'learner' && await page.getByLabel('Sắp xếp').inputValue() === 'name');
check('duplicate và malformed rows bị loại có cảnh báo', await page.getByText(/2 bản ghi sai định dạng hoặc trùng mã người dùng/).count() === 1);
check('định danh độc hại được React escape', await page.locator('.aus-shell img, .aus-shell script, .aus-shell iframe').count() === 0);
await page.getByLabel('Tìm người dùng').fill('');
check('metric nguồn hỏng không bị đổi thành 0', await page.locator('td.is-unknown').count() >= 2 && await page.getByText(/dấu — không có nghĩa là 0/).count() === 1);
check('mobile populated rows không tràn ngang', await page.evaluate(() => document.querySelectorAll('.aus-table tbody tr').length === 2 && document.documentElement.scrollWidth <= window.innerWidth));
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Không thể làm mới — đang giữ dữ liệu cũ.', { exact: true }).waitFor({ state: 'visible' });
check('refresh lỗi giữ snapshot canonical cũ', await page.getByText('An <script>alert(1)</script>', { exact: true }).count() === 1 && userReads === 2);

await page.goto(`${BASE}/admin/usage?code_id=code%2Fwith%20space`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Hoạt động mã COURSE-1', exact: true }).waitFor({ state: 'visible' });
check('code view mã hóa ID và đọc đúng endpoint canonical', requests.some((item) => item.path === '/admin/access-codes/code%2Fwith%20space/usage'));
check('code aggregate giữ tổng phiên unknown và cost thật', await page.getByText('—', { exact: true }).count() >= 1 && await page.getByText('$0.5000', { exact: true }).count() >= 1);
check('code context và đường quay lại Access Codes đúng', await page.getByText('20', { exact: true }).count() >= 1 && await page.getByRole('link', { name: '← Mã kích hoạt' }).getAttribute('href') === '/admin/users?tab=codes');
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop dùng bảng và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.aus-table')).display === 'table' && document.documentElement.scrollWidth <= window.innerWidth));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Usage native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
