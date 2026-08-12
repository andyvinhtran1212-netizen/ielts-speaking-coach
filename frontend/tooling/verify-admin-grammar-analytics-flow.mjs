// Fixture-backed browser contract for native Grammar Analytics.
// All API reads are intercepted; production data is untouched.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000112';
const fakeSession = JSON.stringify({ access_token: 'admin-grammar-analytics-not-real', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-grammar-analytics@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launchChromium() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (_) {} }, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const requests = []; const writes = []; const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
let failRefresh = false; let unavailableViews = false; let rollbackState = null;
const viewed = [{ slug: 'past-perfect', title: 'Past <script>alert(1)</script> Perfect', category: 'tenses', count: 120 }];
const saved = [{ slug: 'modal-verbs', title: 'Modal verbs', category: 'verb-patterns', count: 9 }];
const zero = [{ slug: 'relative-clauses', title: 'Relative clauses', category: 'sentences', count: 0 }];

await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method(); requests.push(`${method} ${parsed.pathname}${parsed.search}`);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) writes.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-grammar-analytics@local', role: 'admin' });
  if (parsed.pathname === '/admin/grammar/analytics') {
    if (failRefresh) { failRefresh = false; return json({ detail: 'analytics unavailable' }, 503); }
    const days = Number(parsed.searchParams.get('days'));
    if (rollbackState === 'unavailable') return json({ days, articles_total: 132, views_total: null, active_view_records_recent: null, saves_total: null, zero_view_total: null, top_viewed: null, top_saved: null, zero_view_slugs: null, analytics_status: { views: 'unavailable', recent_activity: 'unavailable', saves: 'unavailable' }, recent_activity_basis: 'user_article_records_with_last_viewed_at_in_window' });
    if (rollbackState === 'empty') return json({ days, articles_total: 132, views_total: 0, active_view_records_recent: 0, saves_total: 0, zero_view_total: 0, top_viewed: [], top_saved: [], zero_view_slugs: [], analytics_status: { views: 'complete', recent_activity: 'complete', saves: 'complete' }, recent_activity_basis: 'user_article_records_with_last_viewed_at_in_window' });
    return json({ days, articles_total: 132, views_total: unavailableViews ? null : 120, active_view_records_recent: 18, saves_total: 9, zero_view_total: unavailableViews ? null : 1, top_viewed: unavailableViews ? null : viewed, top_saved: saved, zero_view_slugs: unavailableViews ? null : zero, analytics_status: { views: unavailableViews ? 'unavailable' : 'complete', recent_activity: 'complete', saves: 'complete' }, recent_activity_basis: 'user_article_records_with_last_viewed_at_in_window' });
  }
  return json({});
});

await page.goto(`${BASE}/admin/grammar/analytics?days=14`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Analytics snapshot', exact: true }).waitFor({ state: 'visible' });
check('admin gate và canonical days query chạy', requests.some((value) => value === 'GET /auth/me') && requests.some((value) => value === 'GET /admin/grammar/analytics?days=14'));
check('hostile title được React escape', await page.locator('.gax-shell script').count() === 0 && await page.getByText('Past <script>alert(1)</script> Perfect', { exact: true }).count() === 1);
check('schema basis được giải thích trung thực', await page.getByText(/không phải số lượt xem phát sinh theo ngày/).count() === 1);
check('mobile table thành cards không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.gax-table-wrap table')).display === 'block' && document.documentElement.scrollWidth <= window.innerWidth));

await page.getByRole('combobox', { name: 'Cửa sổ', exact: true }).selectOption('30');
await page.waitForURL((url) => url.searchParams.get('days') === '30');
await page.getByText('Record hoạt động · 30 ngày', { exact: true }).waitFor({ state: 'visible' });
check('window được giữ trong URL và query', requests.some((value) => value === 'GET /admin/grammar/analytics?days=30'));

failRefresh = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Không thể làm mới — đang giữ snapshot trước đó.', { exact: true }).waitFor({ state: 'visible' });
check('refresh lỗi giữ snapshot trước đó', await page.getByText('Past <script>alert(1)</script> Perfect', { exact: true }).count() === 1);

unavailableViews = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Một phần analytics không khả dụng.', { exact: true }).waitFor({ state: 'visible' });
check('views lỗi là unknown, không phải zero', await page.getByText('Nguồn không khả dụng', { exact: true }).count() >= 2 && await page.getByText(/Dấu — không có nghĩa là 0/).count() >= 1);

await page.setViewportSize({ width: 1440, height: 900 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Analytics snapshot', exact: true }).waitFor({ state: 'visible' });
check('desktop dùng table và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.gax-table-wrap table')).display === 'table' && document.documentElement.scrollWidth <= window.innerWidth));

rollbackState = 'unavailable';
await page.goto(`${BASE}/pages/admin/grammar/analytics.html?days=30`, { waitUntil: 'domcontentloaded' });
await page.getByText('Nguồn views không khả dụng — không đồng nghĩa với 0.', { exact: true }).waitFor({ state: 'visible' });
rollbackState = 'empty';
await page.getByRole('button', { name: '↺ Tải lại' }).click();
await page.getByText('Chưa có view nào.', { exact: true }).waitFor({ state: 'visible' });
check('rollback phục hồi đúng empty copy sau trạng thái unavailable', await page.getByText('Chưa có save nào.', { exact: true }).count() === 1 && await page.getByText('Mọi article đều đã có view 🎉', { exact: true }).count() === 1 && await page.getByText(/không khả dụng/).count() === 0);
check('không có write ngoài contract', writes.length === 0, writes.join(', '));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Grammar Analytics flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
