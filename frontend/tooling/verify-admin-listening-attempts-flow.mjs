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

const errors = []; const listQueries = []; const detailReads = []; const writes = [];
let legacyPolicy = false, listFailure = false, detailFailure = false;
const longReadFailure = 'Không đọc được dữ liệu đã lưu: ' + 'record_identifier_without_spaces_'.repeat(20);
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !/\/api\/(analytics\/events|error-logs)$/.test(new URL(url).pathname)) writes.push(`${request.method()} ${new URL(url).pathname}`);
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  const json = (body, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'listening-attempts@local', role: 'admin' });
  if (parsed.pathname === '/admin/listening/attempts' && method === 'GET') {
    listQueries.push(parsed.search);
    if (listFailure) return json({ detail: longReadFailure }, 503);
    if (parsed.searchParams.get('user_query') === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, 650));
      return json({ items: [{ id: 'attempt-old', status: 'submitted', scoring_policy: 'diagnostic', score: 1, total_questions: 1, accuracy: 1, duration_seconds: 1, created_at: '2026-08-13T00:00:00Z', user: { id: 'old-user', email: 'old@example.com', display_name: 'Old response' }, test: { id: 'old-test', test_id: 'OLD', title: 'Old test', test_type: 'full' } }], total: 1, limit: 50, offset: 0, association_lookup_failed: false, association_lookup_failures: [] });
    }
    const offset = Number(parsed.searchParams.get('offset') || 0);
    const row = { id: offset ? 'attempt-51' : 'attempt-1', status: 'submitted', ...(!legacyPolicy ? { scoring_policy: 'diagnostic' } : {}), score: 8, total_questions: 10, accuracy: 0.8, duration_seconds: 750, started_at: '2026-08-14T00:00:00Z', submitted_at: '2026-08-14T00:12:30Z', created_at: '2026-08-14T00:00:00Z', user: { id: 'user-1', email: null, display_name: null }, test: { id: 'test-1', test_id: 'ILR-LIS-001', title: 'Listening <script>', test_type: 'full' } };
    const malformed = { ...row, id: 'bad', accuracy: 0.2 };
    return json({ items: offset ? [row] : [row, malformed], total: 75, limit: 50, offset, association_lookup_failed: true, association_lookup_failures: ['users'] });
  }
  if (parsed.pathname === '/admin/listening/attempts/attempt-1' && method === 'GET') {
    detailReads.push(parsed.pathname);
    if (detailFailure) return json({ detail: longReadFailure }, 503);
    return json({ id: 'attempt-1', status: 'submitted', ...(!legacyPolicy ? { scoring_policy: 'diagnostic' } : {}), score: 8, total_questions: 10, accuracy: 0.8, duration_seconds: 750, started_at: '2026-08-14T00:00:00Z', submitted_at: '2026-08-14T00:12:30Z', created_at: '2026-08-14T00:00:00Z', user: { id: 'user-1', email: null, display_name: null }, test: { id: 'test-1', test_id: 'ILR-LIS-001', title: 'Listening <script>', test_type: 'full' }, grading_details: [{ q_num: 1, correct: true, user_answer: '<script>', expected: 'A', trap_caught: true }, { q_num: 0, correct: false }], trap_analytics: { trap_mechanism: { caught: 1, missed: 0 } }, band_estimate: 7, association_lookup_failed: true, association_lookup_failures: ['users'] });
  }
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

async function checkWarningGeometry(label) {
  for (const width of [360, 390, 768, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    const bounds = await page.evaluate(() => ({
      viewport: innerWidth, scroll: document.documentElement.scrollWidth,
      thead: getComputedStyle(document.querySelector('.ala-table thead')).display,
      banners: [...document.querySelectorAll('.ala-shell .alc-banner')].map(banner => {
        const parent = banner.getBoundingClientRect();
        return { right: parent.right, children: [...banner.children].map(child => ({
          right: child.getBoundingClientRect().right, width: child.getBoundingClientRect().width,
          clipped: ['hidden', 'clip'].includes(getComputedStyle(child).overflowX),
        })) };
      }),
    }));
    check(`${label}: cảnh báo đọc được, không tràn ở ${width}px ${theme}`, bounds.scroll <= bounds.viewport
      && (width <= 760 ? bounds.thead === 'none' : bounds.thead !== 'none')
      && bounds.banners.length > 0 && bounds.banners.every(banner => banner.right <= bounds.viewport + 1
        && banner.children.every(child => child.right <= banner.right + 1 && !child.clipped)), JSON.stringify(bounds));
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

await page.goto(`${BASE}/admin/listening/attempts?user=slow&type=full&status=submitted`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Lượt làm bài Listening' }).waitFor();
await page.getByRole('searchbox', { name: 'Học viên', exact: true }).fill('learner@example.com');
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.getByText('Listening <script>', { exact: true }).waitFor();
check('admin gate và canonical filter query chạy', listQueries.some((query) => query.includes('user_query=learner%40example.com') && query.includes('test_type=full') && query.includes('status=submitted')), listQueries.join(' | '));
await page.waitForTimeout(700);
check('response bộ lọc cũ không ghi đè snapshot mới', await page.getByText('Old response', { exact: true }).count() === 0 && await page.getByText('Listening <script>', { exact: true }).count() === 1);
check('hostile title được React escape', await page.locator('script').filter({ hasText: 'Listening' }).count() === 0 && await page.getByText('Listening <script>', { exact: true }).count() === 1);
check('malformed row không làm mất canonical total', await page.getByText(/Chưa hiển thị 1 dòng trên trang này/).count() === 1 && await page.getByText(/75 lượt/).count() >= 1 && await page.locator('.ala-table tbody tr').count() === 1 && await page.locator('[data-attempt-id="bad"]').count() === 0);
check('join failure hiện cảnh báo và không giả thành ô trống', await page.getByText('Không đọc được thông tin liên kết', { exact: true }).count() === 1 && await page.locator('td[data-label="Học viên"]').getByText('⚠ Lỗi đọc thông tin', { exact: true }).count() === 1 && await page.locator('td[data-label="Học viên"] small').innerText() === 'user-1');
check('canonical diagnostic fixture không tạo warning legacy', await page.getByText('Chưa xác minh chính sách tính điểm', { exact: true }).count() === 0);
check('sidebar trỏ route native', await page.evaluate(() => [...(document.querySelector('aver-admin-chrome')?.shadowRoot?.querySelectorAll('a') || [])].find((link) => link.textContent?.includes('Lượt làm bài'))?.getAttribute('href') === '/admin/listening/attempts'));
check('danh sách không còn escape sang HTML đã retire', await page.getByRole('link', { name: /HTML rollback/ }).count() === 0);
check('mobile cards không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.ala-table thead')).display === 'none' && document.documentElement.scrollWidth <= innerWidth));
listFailure = true;
await page.getByRole('button', { name: 'Làm mới', exact: true }).click();
await page.getByText('Không tải được lịch sử làm bài', { exact: true }).waitFor();
check('refresh failure giữ canonical snapshot và total', await page.getByText(/Không thể làm mới — đang giữ snapshot trước/).count() === 1 && await page.locator('.ala-table tbody tr').count() === 1 && await page.getByText(/75 lượt theo bộ lọc/).count() === 1);
await checkWarningGeometry('List join/invalid/long error');
listFailure = false;
await page.getByRole('button', { name: 'Làm mới', exact: true }).click();
await page.getByText('Không tải được lịch sử làm bài', { exact: true }).waitFor({ state: 'hidden' });

await page.getByRole('button', { name: 'Xem từng câu' }).click();
await page.getByRole('heading', { name: 'Chi tiết lượt làm bài' }).waitFor();
// The drawer heading is part of the static loading shell. Wait for both
// canonical side effects of the detail read before asserting them; otherwise
// a slower CI runner can inspect the shell between click and fetch commit.
await page.waitForFunction(() => new URL(location.href).searchParams.get('attempt') === 'attempt-1');
await page.getByText('<script>', { exact: true }).waitFor();
check('detail dùng exact attempt identity và ghi vào URL', detailReads.length === 1 && new URL(page.url()).searchParams.get('attempt') === 'attempt-1');
check('hostile answer được escape', await page.locator('script').filter({ hasText: '<script>' }).count() === 0 && await page.getByText('<script>', { exact: true }).count() === 1);
check('question contract lỗi được báo riêng', await page.locator('.ala-detail').getByText(/Chưa hiển thị 1 dòng chấm vì dữ liệu không hợp lệ/).count() === 1 && await page.locator('.ala-question-table tbody tr').count() === 1);
check('summary + trap + per-question truth hiện đủ', await page.getByText('8/10', { exact: true }).count() >= 1 && await page.getByText('1 tránh · 0 dính', { exact: true }).count() === 1 && await page.getByText('Tránh được', { exact: true }).count() === 1);
check('detail join failure hiện riêng với canonical question evidence', await page.locator('.ala-detail').getByText('Không đọc được thông tin liên kết', { exact: true }).count() === 1 && await page.locator('.ala-detail').getByText(/Không đọc được học viên cho lượt làm bài này/).count() === 1);
await checkWarningGeometry('Detail join/invalid');

await page.getByRole('button', { name: 'Đóng' }).click();
await page.waitForFunction(() => !new URL(location.href).searchParams.has('attempt'));
check('đóng detail loại attempt identity khỏi URL', await page.getByRole('heading', { name: 'Chi tiết lượt làm bài' }).count() === 0);

detailFailure = true;
await page.getByRole('button', { name: 'Xem từng câu' }).click();
await page.getByText('Không tải được chi tiết', { exact: true }).waitFor();
check('detail read failure không giữ câu chấm cũ', await page.locator('.ala-question-table').count() === 0);
await checkWarningGeometry('Detail long error');
await page.locator('.ala-detail').getByRole('button', { name: 'Đóng', exact: true }).click();
await page.locator('.ala-detail').waitFor({ state: 'hidden' });
detailFailure = false;

legacyPolicy = true;
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('Chưa xác minh chính sách tính điểm', { exact: true }).waitFor();
check('missing policy vẫn hiện graded legacy row, total và warning riêng', await page.getByText(/1 lượt hiển thị chưa có chính sách tính điểm/).count() === 1 && await page.getByText(/75 lượt theo bộ lọc/).count() === 1 && await page.locator('.ala-table tbody tr').count() === 1 && await page.getByText('Không tính điểm', { exact: true }).count() === 0);
await checkWarningGeometry('List explicit legacy warning');
await page.getByRole('button', { name: 'Xem từng câu' }).click();
await page.locator('.ala-detail').getByText(/Dữ liệu trả về chưa có chính sách tính điểm cho lượt này/).waitFor();
check('missing policy detail giữ grading cũ và warning, không suy ra report-only', await page.locator('.ala-question-table tbody tr').count() === 1 && await page.locator('.ala-detail__summary').getByText('8/10', { exact: true }).count() === 1 && await page.locator('.ala-detail__summary').getByText('Không tính điểm', { exact: true }).count() === 0);
await checkWarningGeometry('Detail explicit legacy warning');
await page.locator('.ala-detail').getByRole('button', { name: 'Đóng', exact: true }).click();
await page.locator('.ala-detail').waitFor({ state: 'hidden' });

await page.getByRole('button', { name: 'Sau →' }).click();
await page.getByText('attempt-51', { exact: true }).waitFor();
check('pagination chuyển canonical offset', listQueries.at(-1)?.includes('offset=50') === true && new URL(page.url()).searchParams.get('page') === '2');

await page.setViewportSize({ width: 1440, height: 900 });
check('desktop table không tràn trang', await page.evaluate(() => getComputedStyle(document.querySelector('.ala-table thead')).display !== 'none' && document.documentElement.scrollWidth <= innerWidth));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));
check('read journeys không ghi business data', writes.length === 0, writes.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening attempts flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
