// Fixture-backed browser contract for native AI usage reporting.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-admin-ai-usage-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000092';
const fakeSession = JSON.stringify({ access_token: 'admin-ai-usage-not-a-real-token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-ai-usage@local' } });
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-ai-usage@local', role: 'admin' });
  if (parsed.pathname === '/admin/ai-usage') {
    const cost = parsed.searchParams.get('days') === '30' ? 23.4567 : 12.3456;
    return json({
    overall: { calls: 10000, cost_usd: cost, by_service: { claude: { calls: 6000, cost_usd: 10 }, gemini: { calls: 3000, cost_usd: 2 }, custom_provider: { calls: 1000, cost_usd: .3456 } } },
    per_user: [{ user_id: 'user-1', email: 'learner<img src=x>@example.com', display_name: 'An <script>alert(1)</script>', calls: 10000, cost_usd: cost, by_service: { claude: { calls: 6000, cost_usd: 10 }, custom_provider: { calls: 1000, cost_usd: .3456 } } }],
    meta: { query_limit: 10000, returned_rows: 10000, total_matching_rows: 12000, truncated: true },
  });
  }
  return json({});
});

await page.goto(`${BASE}/admin/system/ai-usage`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Chi phí AI', exact: true }).waitFor({ state: 'visible' });
await page.getByText('$12.3456', { exact: true }).first().waitFor({ state: 'visible' });
check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('mặc định đọc cửa sổ 7 ngày', requests.some((item) => item.path === '/admin/ai-usage' && item.search === '?days=7'));
check('cap backend hiện rõ nghĩa ít nhất thay vì tổng tuyệt đối', await page.getByText(/ít nhất 10\.000 lượt gọi/).count() === 1 && await page.getByText(/giới hạn 10\.000 log/).count() === 1);
check('service lạ không bị nuốt hoặc cộng nhầm', await page.getByText('custom_provider', { exact: true }).count() >= 1 && await page.getByText('Whisper', { exact: true }).count() === 0);
check('dữ liệu định danh độc hại được React escape', await page.getByText('An <script>alert(1)</script>', { exact: true }).count() === 1 && await page.locator('.aiun-shell img, .aiun-shell script, .aiun-shell iframe').count() === 0);
await page.getByLabel('Khoảng thời gian').selectOption('30');
await page.getByText('$23.4567', { exact: true }).first().waitFor({ state: 'visible' });
check('period đồng bộ URL và request canonical', new URL(page.url()).searchParams.get('days') === '30' && requests.some((item) => item.path === '/admin/ai-usage' && item.search === '?days=30'));
await page.getByLabel('Khoảng thời gian').selectOption('all');
await page.getByText('$12.3456', { exact: true }).first().waitFor({ state: 'visible' });
check('tất cả thời gian có URL bền vững nhưng không gửi days sai kiểu', new URL(page.url()).searchParams.get('days') === 'all' && requests.some((item) => item.path === '/admin/ai-usage' && item.search === ''));
check('mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin AI Usage native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
