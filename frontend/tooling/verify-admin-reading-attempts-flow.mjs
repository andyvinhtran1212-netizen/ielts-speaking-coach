// Fixture-backed browser contract for native + rollback Reading attempts.
// Every API call is intercepted; production data is never read or mutated.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000109';
const fakeSession = JSON.stringify({ access_token: 'admin-reading-attempts-not-a-real-token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-reading-attempts@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launchChromium() { try { return await chromium.launch(); } catch (error) { const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome }); throw error; } }

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (_) {} }, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const requests = [];
const unexpectedWrites = [];
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

let refreshFails = false;
let lookupFails = false;
function payload(days, status = 'complete') {
  const unavailable = status === 'unavailable';
  const partial = status === 'partial';
  const incompleteCoverage = partial && !lookupFails;
  return {
    ok: !unavailable, data_status: status, window_days: days,
    window_start: '2026-07-13T08:00:00Z', snapshot_to: '2026-08-12T08:00:00Z', computed_at: '2026-08-12T08:00:05Z',
    totals: unavailable
      ? { submitted_all_time: 90, submitted_window: null, auth_attempts: null, anon_attempts: null, auth_distinct_users: null, anon_distinct_sources: null, truncated: false }
      : { submitted_all_time: 90, submitted_window: 2350, auth_attempts: 1800, anon_attempts: 550, auth_distinct_users: 37, anon_distinct_sources: 21, truncated: incompleteCoverage },
    band_distribution: unavailable ? [] : [{ band: 6.5, count: 1200 }, { band: 7, count: 1150 }],
    skill_performance: unavailable ? [] : [{ skill_tag: 'inference', correct: 30, total: 100, accuracy: 0.3 }, { skill_tag: 'detail', correct: 82, total: 100, accuracy: 0.82 }],
    time_stats: unavailable ? { avg_minutes: null, median_minutes: null, count: 0 } : { avg_minutes: 48.2, median_minutes: 49, count: 2200 },
    per_test: unavailable ? [] : [{ test_id: 'CAM-READ-1', title: 'Reading <script>alert(1)</script>', attempts: 2350, auth: 1800, anon: 550, avg_band: 6.6 }],
    recent: unavailable ? [] : [{ submitted_at: '2026-08-12T07:00:00Z', test_title: 'Reading <script>alert(1)</script>', who: 'learner@example.com', is_anonymous: false, band: 6.5, time_minutes: 48 }],
    malformed_count: incompleteCoverage ? 1 : 0,
    lookup_failures: lookupFails ? ['all_time_count', 'test_titles', 'recent_identities'] : [],
  };
}

await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  requests.push({ method, path: parsed.pathname, search: parsed.search });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) unexpectedWrites.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-reading-attempts@local', role: 'admin' });
  if (parsed.pathname === '/admin/dashboard/reading-attempts') {
    if (refreshFails) { refreshFails = false; return json({ detail: 'attempt source unavailable' }, 503); }
    const days = Number(parsed.searchParams.get('days') || 30);
    const body = payload(days, days === 7 || lookupFails ? 'partial' : days === 90 ? 'unavailable' : 'complete');
    if (lookupFails) body.totals.submitted_all_time = null;
    return json(body);
  }
  return json({});
});

await page.goto(`${BASE}/admin/dashboard/reading-attempts`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Lượt làm bài Reading', exact: true }).waitFor({ state: 'visible' });
await page.getByText('Reading <script>alert(1)</script>', { exact: true }).first().waitFor({ state: 'visible' });
check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('default URL gọi canonical 30-day snapshot', requests.some((item) => item.path === '/admin/dashboard/reading-attempts' && item.search === '?days=30'));
check('nội dung độc hại được React escape', await page.locator('.ara-shell script, .ara-shell iframe').count() === 0);
check('mobile tables thành card và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.ara-table')).display === 'grid' && document.documentElement.scrollWidth <= window.innerWidth));
check('phân bố có vùng keyboard + bảng text thay thế', await page.evaluate(() => document.querySelector('.ara-bars')?.tabIndex === 0 && document.querySelectorAll('.ara-sr-table tbody tr').length === 2));

refreshFails = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Không thể làm mới — đang giữ snapshot trước đó.', { exact: true }).waitFor({ state: 'visible' });
check('refresh lỗi giữ snapshot canonical cũ', await page.getByText('Reading <script>alert(1)</script>', { exact: true }).count() >= 1);

lookupFails = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Một số nguồn phụ không đọc được.', { exact: true }).waitFor({ state: 'visible' });
const lookupBannerText = await page.locator('.ara-banner.is-warning').filter({ hasText: 'Một số nguồn phụ không đọc được.' }).textContent();
check('native nêu rõ từng lookup failure và không biến chúng thành coverage thiếu', !!lookupBannerText?.includes('tổng lượt toàn thời gian, tên đề Reading, danh tính lượt nộp gần đây') && await page.getByText('Snapshot chưa đầy đủ.', { exact: true }).count() === 0, lookupBannerText || 'missing lookup banner');
lookupFails = false;

await page.getByRole('button', { name: '7 ngày' }).click();
await page.waitForURL((url) => url.searchParams.get('days') === '7');
await page.getByText('Snapshot chưa đầy đủ.', { exact: true }).waitFor({ state: 'visible' });
check('partial giữ tổng exact, dùng cận dưới cho split và ẩn trung bình', await page.getByText('2.350', { exact: true }).count() >= 1 && await page.getByText(/≥ 1\.800 đăng nhập/).count() >= 1 && await page.getByText('Không kết luận từ dữ liệu thiếu', { exact: true }).count() >= 1);
check('filter 7 ngày được giữ trong URL', new URL(page.url()).searchParams.get('days') === '7');

await page.getByRole('button', { name: '90 ngày' }).click();
await page.getByText('Dữ liệu lượt làm bài hiện không khả dụng', { exact: true }).waitFor({ state: 'visible' });
check('unavailable không hiển thị số 0 giả', await page.getByText(/dấu — không có nghĩa là 0/).count() === 1);

await page.goto(`${BASE}/pages/admin/dashboard/reading-attempts.html`, { waitUntil: 'domcontentloaded' });
lookupFails = true;
await page.locator('#rd-refresh').click();
await page.getByText(/Nguồn phụ không đọc được: tổng lượt toàn thời gian, tên đề Reading, danh tính lượt nộp gần đây/).waitFor({ state: 'visible' });
check('rollback nêu rõ lookup failures và giữ all-time ở trạng thái chưa biết', await page.locator('#rd-total-alltime').textContent() === '—');
lookupFails = false;
await page.locator('#rd-window').selectOption('90');
await page.getByText(/dấu — không có nghĩa là 0/).waitFor({ state: 'visible' });
check('rollback page giữ trạng thái unavailable', await page.locator('#rd-total-window').textContent() === '—');
await page.locator('#rd-window').selectOption('7');
await page.getByText(/Snapshot chưa đầy đủ/).waitFor({ state: 'visible' });
check('rollback partial giữ tổng exact, split lower-bound và ẩn trung bình', (await page.locator('#rd-total-window').textContent()) === '2.350' && (await page.locator('#rd-split').textContent())?.includes('≥') && (await page.locator('#rd-anon-sources').textContent())?.includes('≈ ≥') && await page.locator('#rd-time-avg').textContent() === '—');

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/admin/dashboard/reading-attempts`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Lượt làm bài Reading', exact: true }).waitFor({ state: 'visible' });
check('desktop dùng bảng và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.ara-table')).display === 'table' && document.documentElement.scrollWidth <= window.innerWidth));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Reading Attempts native + rollback flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
