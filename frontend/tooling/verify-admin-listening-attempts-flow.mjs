// Fixture-backed browser contract for native Admin Listening attempt inventory.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000122';
const session = JSON.stringify({ access_token: 'admin-listening-attempts-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'listening-attempts@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const errors = []; const listQueries = []; const detailReads = [];
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  const json = (body, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'listening-attempts@local', role: 'admin' });
  if (parsed.pathname === '/admin/listening/attempts' && method === 'GET') {
    listQueries.push(parsed.search);
    if (parsed.searchParams.get('user_query') === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, 650));
      return json({ items: [{ id: 'attempt-old', status: 'submitted', score: 1, total_questions: 1, accuracy: 1, duration_seconds: 1, created_at: '2026-08-13T00:00:00Z', user: { id: 'old-user', email: 'old@example.com', display_name: 'Old response' }, test: { id: 'old-test', test_id: 'OLD', title: 'Old test', test_type: 'full' } }], total: 1, limit: 50, offset: 0, association_lookup_failed: false, association_lookup_failures: [] });
    }
    const offset = Number(parsed.searchParams.get('offset') || 0);
    const row = { id: offset ? 'attempt-51' : 'attempt-1', status: 'submitted', score: 8, total_questions: 10, accuracy: 0.8, duration_seconds: 750, started_at: '2026-08-14T00:00:00Z', submitted_at: '2026-08-14T00:12:30Z', created_at: '2026-08-14T00:00:00Z', user: { id: 'user-1', email: null, display_name: null }, test: { id: 'test-1', test_id: 'ILR-LIS-001', title: 'Listening <script>', test_type: 'full' } };
    const malformed = { ...row, id: 'bad', accuracy: 0.2 };
    return json({ items: offset ? [row] : [row, malformed], total: 75, limit: 50, offset, association_lookup_failed: true, association_lookup_failures: ['users'] });
  }
  if (parsed.pathname === '/admin/listening/attempts/attempt-1' && method === 'GET') {
    detailReads.push(parsed.pathname);
    return json({ id: 'attempt-1', status: 'submitted', score: 8, total_questions: 10, accuracy: 0.8, duration_seconds: 750, started_at: '2026-08-14T00:00:00Z', submitted_at: '2026-08-14T00:12:30Z', created_at: '2026-08-14T00:00:00Z', user: { id: 'user-1', email: 'learner@example.com', display_name: 'Learner <img>' }, test: { id: 'test-1', test_id: 'ILR-LIS-001', title: 'Listening <script>', test_type: 'full' }, grading_details: [{ q_num: 1, correct: true, user_answer: '<script>', expected: 'A', trap_caught: true }, { q_num: 0, correct: false }], trap_analytics: { trap_mechanism: { caught: 1, missed: 0 } }, band_estimate: 7, association_lookup_failed: false, association_lookup_failures: [] });
  }
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/listening/attempts?user=slow&type=full&status=submitted`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Lượt làm bài Listening' }).waitFor();
await page.getByRole('searchbox', { name: 'Học viên', exact: true }).fill('learner@example.com');
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.getByText('Listening <script>', { exact: true }).waitFor();
check('admin gate và canonical filter query chạy', listQueries.some((query) => query.includes('user_query=learner%40example.com') && query.includes('test_type=full') && query.includes('status=submitted')), listQueries.join(' | '));
await page.waitForTimeout(700);
check('response bộ lọc cũ không ghi đè snapshot mới', await page.getByText('Old response', { exact: true }).count() === 0 && await page.getByText('Listening <script>', { exact: true }).count() === 1);
check('hostile title được React escape', await page.locator('script').filter({ hasText: 'Listening' }).count() === 0 && await page.getByText('Listening <script>', { exact: true }).count() === 1);
check('malformed row không làm mất canonical total', await page.getByText(/Đã loại 1 dòng/).count() === 1 && await page.getByText(/75 lượt/).count() >= 1);
check('join failure hiện cảnh báo và không giả thành ô trống', await page.getByText('Lookup association thất bại', { exact: true }).count() === 1 && await page.getByText('⚠ Lookup failed', { exact: true }).count() >= 1);
check('sidebar trỏ route native', await page.evaluate(() => [...(document.querySelector('aver-admin-chrome')?.shadowRoot?.querySelectorAll('a') || [])].find((link) => link.textContent?.includes('Lượt làm bài'))?.getAttribute('href') === '/admin/listening/attempts'));
check('rollback giữ bộ lọc học viên được legacy hỗ trợ', await page.getByRole('link', { name: /Mở bản HTML rollback/ }).getAttribute('href') === '/pages/admin/listening/attempts.html?user=learner%40example.com');
check('mobile cards không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.ala-table thead')).display === 'none' && document.documentElement.scrollWidth <= innerWidth));

await page.getByRole('button', { name: 'Xem từng câu' }).click();
await page.getByRole('heading', { name: 'Chi tiết lượt làm bài' }).waitFor();
// The drawer heading is part of the static loading shell. Wait for both
// canonical side effects of the detail read before asserting them; otherwise
// a slower CI runner can inspect the shell between click and fetch commit.
await page.waitForFunction(() => new URL(location.href).searchParams.get('attempt') === 'attempt-1');
await page.getByText('<script>', { exact: true }).waitFor();
check('detail dùng exact attempt identity và ghi vào URL', detailReads.length === 1 && new URL(page.url()).searchParams.get('attempt') === 'attempt-1');
check('hostile answer được escape', await page.locator('script').filter({ hasText: '<script>' }).count() === 0 && await page.getByText('<script>', { exact: true }).count() === 1);
check('question contract lỗi được báo riêng', await page.getByText(/Đã loại 1 dòng chấm sai contract/).count() === 1);
check('summary + trap + per-question truth hiện đủ', await page.getByText('8/10', { exact: true }).count() >= 1 && await page.getByText('1 tránh · 0 dính', { exact: true }).count() === 1 && await page.getByText('Tránh được', { exact: true }).count() === 1);

await page.getByRole('button', { name: 'Đóng' }).click();
await page.waitForFunction(() => !new URL(location.href).searchParams.has('attempt'));
check('đóng detail loại attempt identity khỏi URL', await page.getByRole('heading', { name: 'Chi tiết lượt làm bài' }).count() === 0);

await page.getByRole('button', { name: 'Sau →' }).click();
await page.getByText('attempt-51', { exact: true }).waitFor();
check('pagination chuyển canonical offset', listQueries.at(-1)?.includes('offset=50') === true && new URL(page.url()).searchParams.get('page') === '2');

await page.setViewportSize({ width: 1440, height: 900 });
check('desktop table không tràn trang', await page.evaluate(() => getComputedStyle(document.querySelector('.ala-table thead')).display !== 'none' && document.documentElement.scrollWidth <= innerWidth));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening attempts flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
