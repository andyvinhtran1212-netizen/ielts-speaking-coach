// Fixture-backed browser contract for native foot-traffic analytics.
// Every API call is intercepted; production data is never read or mutated.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000095';
const fakeSession = JSON.stringify({ access_token: 'admin-foot-traffic-not-a-real-token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-foot-traffic@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launchChromium() { try { return await chromium.launch(); } catch (error) { const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome }); throw error; } }

const requests = [];
const unexpectedWrites = [];
let reads = 0;
let homeReads = 0;
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-foot-traffic@local', role: 'admin' });
  if (parsed.pathname === '/admin/analytics/foot-traffic') {
    reads += 1;
    const requestedRoute = parsed.searchParams.get('route');
    if (requestedRoute === '/home') {
      homeReads += 1;
      if (homeReads === 3) return json({ detail: 'analytics unavailable' }, 503);
    }
    if (requestedRoute === '/unavailable') return json({ data_status: 'unavailable', truncated: false, date_from: parsed.searchParams.get('date_from'), date_to: parsed.searchParams.get('date_to'), route: requestedRoute, snapshot_to: '2026-08-12T09:00:00Z', effective_to: '2026-08-12T08:59:55Z', total_views: null, unique_visitors: null, anonymous_hits: null, top_pages: [], daily: [] });
    return json({
      data_status: requestedRoute === '/partial' ? 'partial' : 'complete', truncated: requestedRoute === '/partial',
      date_from: parsed.searchParams.get('date_from'), date_to: parsed.searchParams.get('date_to'), route: parsed.searchParams.get('route'), snapshot_to: '2026-08-12T08:00:00Z', effective_to: '2026-08-12T07:59:55Z',
      total_views: 2350, unique_visitors: 37, anonymous_hits: 404,
      top_pages: [{ path: '/home<script>alert(1)</script>', views: 1200 }, { path: '/speaking', views: 900 }],
      daily: Array.from({ length: 30 }, (_, index) => ({ date: `2026-07-${String(index + 1).padStart(2, '0')}`, views: 1000 + index * 7 })),
    });
  }
  return json({});
});

await page.goto(`${BASE}/admin/foot-traffic?from=2026-08-01&to=2026-08-12&route=%2Fhome`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Lưu lượng truy cập', exact: true }).waitFor({ state: 'visible' });
await page.getByText('/home<script>alert(1)</script>', { exact: true }).waitFor({ state: 'visible' });
check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
const firstRead = requests.find((item) => item.path === '/admin/analytics/foot-traffic');
check('URL filters đi vào endpoint canonical', firstRead?.search.includes('route=%2Fhome') && firstRead.search.includes('date_from=2026-08-01T00%3A00%3A00.000Z') && firstRead.search.includes('date_to=2026-08-12T23%3A59%3A59.999Z'));
check('path độc hại được React escape', await page.locator('.aft-shell script, .aft-shell iframe').count() === 0);
check('mobile populated rows không tràn ngang', await page.evaluate(() => document.querySelectorAll('.aft-table tbody tr').length === 2 && document.documentElement.scrollWidth <= window.innerWidth));
check('biểu đồ 30 ngày cuộn được bằng bàn phím và có bảng text thay thế', await page.evaluate(() => document.querySelectorAll('.aft-bar').length === 30 && document.querySelector('.aft-chart')?.tabIndex === 0 && document.querySelectorAll('.aft-sr-table tbody tr').length === 30));
await page.evaluate(() => window.history.replaceState(null, '', '/admin/foot-traffic?from=2026-08-01&to=2026-08-12&route=%2Fhome&empty='));
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.getByRole('button', { name: 'Làm mới' }).waitFor({ state: 'visible' });
check('chuẩn hóa URL cùng scope không treo loading', await page.getByRole('button', { name: 'Làm mới' }).isEnabled());
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Không thể làm mới — đang giữ số liệu trước đó.', { exact: true }).waitFor({ state: 'visible' });
check('refresh lỗi giữ snapshot canonical cũ', await page.getByText('/home<script>alert(1)</script>', { exact: true }).count() === 1 && homeReads === 3);
await page.getByLabel('Đường dẫn').fill('/unavailable');
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.getByText('Số liệu hiện không khả dụng', { exact: true }).waitFor({ state: 'visible' });
check('nguồn lỗi không hiển thị số 0 giả', await page.getByText(/dấu — không có nghĩa là 0 lượt xem/).count() === 1);
await page.getByLabel('Đường dẫn').fill('/partial');
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.getByText('Số liệu chưa đầy đủ.', { exact: true }).waitFor({ state: 'visible' });
check('partial read dùng lower-bound thay vì tổng hoàn chỉnh', await page.getByText('≥ 2.350', { exact: true }).count() >= 1);
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop dùng bảng và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.aft-table')).display === 'table' && document.documentElement.scrollWidth <= window.innerWidth));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Foot Traffic native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
