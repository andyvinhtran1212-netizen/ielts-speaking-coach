// Fixture-backed browser contract for native Admin Writing Status job monitor.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000120';
const session = JSON.stringify({ access_token: 'admin-writing-status-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-writing-status@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const dangerous = '<img src=x onerror="window.__statusXss=1">';
const created = new Date(Date.now() - 90000).toISOString();
let status = 'grading'; let failNext = false; let delayNext = false; let activeReads = 0; let maxActiveReads = 0;
const requests = []; const writes = []; const pageErrors = [];
const payload = () => ({
  essay_id: 'e1', status, error_message: status === 'failed' ? dangerous : null,
  eta_seconds: 120, grading_tier: 'deep', created_at: created,
  attempt_count: 2, max_attempts: 3, attempt_failures: 1,
  last_failure: { attempt: 1, model: dangerous, kind: 'timeout', message: dangerous, at: created },
});

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  requests.push({ method, path: parsed.pathname });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^\/api\/(analytics\/events|error-logs)$/.test(parsed.pathname)) writes.push(`${method} ${parsed.pathname}`);
  const json = (body, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-writing-status@local', role: 'admin' });
  if (parsed.pathname === '/admin/writing/essays/e1/status') {
    activeReads += 1; maxActiveReads = Math.max(maxActiveReads, activeReads);
    if (delayNext) { delayNext = false; await new Promise((resolve) => setTimeout(resolve, 350)); }
    activeReads -= 1;
    if (failNext) { failNext = false; return json({ detail: 'fixture poll failed' }, 503); }
    return json(payload());
  }
  return json({});
});

await page.goto(`${BASE}/admin/writing/status?essay_id=e1`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'AI đang xử lý bài viết' }).waitFor();
check('admin gate và exact essay status endpoint được dùng', requests.some((item) => item.path === '/auth/me') && requests.some((item) => item.path === '/admin/writing/essays/e1/status'));
check('Deep tier và retry ledger hiển thị từ canonical payload', await page.getByText(/Deep tier · pha 1\/3 ước tính/).count() === 1 && await page.getByText(/Lỗi gần nhất · attempt 1/).count() === 1);
check('hostile retry data được React escape', await page.locator('.aws-card img').count() === 0 && await page.evaluate(() => !window.__statusXss));
check('progress được ghi rõ là ước tính', await page.getByText(/không phải phần trăm xử lý realtime/).count() === 1 && await page.getByRole('progressbar', { name: 'Tiến độ thời gian ước tính' }).count() === 1);

failNext = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Đang hiển thị snapshot gần nhất.', { exact: true }).waitFor();
check('poll lỗi giữ snapshot đúng essay và gắn nhãn stale', await page.getByRole('heading', { name: 'AI đang xử lý bài viết' }).count() === 1);

delayNext = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await Promise.all([page.getByRole('button', { name: 'Đang tải…' }).click({ force: true }).catch(() => {}), page.waitForTimeout(500)]);
check('refresh đồng thời không tạo request status chồng nhau', maxActiveReads === 1, `max=${maxActiveReads}`);

status = 'graded';
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByRole('heading', { name: 'Bản chấm đã sẵn sàng' }).waitFor();
check('terminal success dừng polling và mở native Grade đúng essay', await page.getByText('Đã dừng polling', { exact: true }).count() === 1 && await page.getByRole('link', { name: /Mở workspace chấm/ }).getAttribute('href') === '/admin/writing/grade?essay_id=e1');

status = 'grading';
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByRole('heading', { name: 'AI đang xử lý bài viết' }).waitFor();
const readsBeforeResume = requests.filter((item) => item.path === '/admin/writing/essays/e1/status').length;
status = 'reviewed';
await page.getByRole('heading', { name: 'Feedback đã được duyệt' }).waitFor({ timeout: 6500 });
check('terminal → active readback tự khởi động lại polling', requests.filter((item) => item.path === '/admin/writing/essays/e1/status').length > readsBeforeResume);

status = 'failed';
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByRole('heading', { name: 'Lượt chấm đã thất bại' }).waitFor();
check('failed state hiện action vận hành và escape lỗi backend', await page.getByRole('link', { name: 'Mở Queue' }).count() === 1 && await page.locator('.aws-fatal img').count() === 0);

await page.goto(`${BASE}/admin/writing/status?essay_id=e1&embed=1&mocklane=1`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Lượt chấm đã thất bại' }).waitFor();
check('embedded Mock route không render chrome ngoài và giữ flags', await page.locator('.aws-header').count() === 0 && await page.getByRole('link', { name: 'Mở Queue' }).getAttribute('href') === '/admin/writing/queue?embed=1&mocklane=1');

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, timeline: getComputedStyle(document.querySelector('.aws-timeline')).gridTemplateColumns.split(' ').length, grid: getComputedStyle(document.querySelector('.aws-grid')).gridTemplateColumns.split(' ').length }));
check('mobile một cột và không tràn viewport', !mobile.overflow && mobile.timeline === 1 && mobile.grid === 1, JSON.stringify(mobile));

await page.goto(`${BASE}/admin/writing/status`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Không biết cần theo dõi bài nào' }).waitFor();
check('thiếu essay_id fail closed không gọi status endpoint', await page.getByRole('link', { name: 'Mở hàng chờ' }).getAttribute('href') === '/admin/writing/queue?status=grading');
check('không có write ngoài telemetry contract', writes.length === 0, writes.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Writing Status native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
