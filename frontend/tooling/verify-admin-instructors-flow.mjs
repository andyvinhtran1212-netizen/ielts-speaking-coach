// Fixture-backed browser contract for native instructor oversight.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-admin-instructors-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-instructors@local', role: 'admin' });
  if (parsed.pathname === '/admin/instructors') return json([
    { instructor_id: instructorId, email: 'teacher<img src=x>@example.com', display_name: 'Cô <script>alert(1)</script>', students: 13, prompts: 8, graded: 21, regraded: 2, regrade_events: 7, tokens: 12345, cost_usd: 1.2345 },
    { instructor_id: 'teacher-2', email: 'second@example.com', display_name: 'Thầy Bình', students: 4, prompts: 2, graded: 5, regraded: 1, regrade_events: 1, tokens: 500, cost_usd: .25 },
    { instructor_id: 'broken', students: -1 },
  ]);
  return json({});
});

await page.goto(`${BASE}/admin/instructors`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Giảng viên', exact: true }).waitFor({ state: 'visible' });
await page.getByText('Cô <script>alert(1)</script>', { exact: true }).waitFor({ state: 'visible' });
check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
const canonicalReads = requests.filter((item) => item.path === '/admin/instructors' && item.method === 'GET');
check('đọc đúng endpoint canonical một lần', canonicalReads.length === 1, canonicalReads.map((item) => `${item.method} ${item.path}${item.search}`).join(', '));
check('tổng quan dùng đúng dữ liệu hợp lệ', await page.getByText('17', { exact: true }).count() >= 1 && await page.getByText('$1.4845', { exact: true }).count() === 1);
check('phân biệt bài chấm lại và tổng lượt chấm lại', await page.getByText('Bài từng chấm lại', { exact: true }).count() === 2 && await page.getByText('Tổng lượt chấm lại', { exact: true }).count() === 2 && await page.getByText('7', { exact: true }).count() >= 1);
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
check('mobile có card dữ liệu và không tràn ngang', await page.evaluate(() => (
  document.querySelectorAll('.ain-card').length === 2
  && document.documentElement.scrollWidth <= window.innerWidth
)));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop dùng hai cột card và không tràn ngang', await page.evaluate(() => {
  const list = document.querySelector('.ain-list');
  return document.documentElement.scrollWidth <= window.innerWidth
    && Boolean(list)
    && getComputedStyle(list).gridTemplateColumns.split(' ').length === 2;
}));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Instructors native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
