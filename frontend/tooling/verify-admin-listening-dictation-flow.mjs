// Fixture-backed browser contract for native Admin Listening dictation reports.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000123';
const session = JSON.stringify({ access_token: 'admin-listening-dictation-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'listening-dictation@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const errors = []; const listQueries = []; const aggregateQueries = []; const detailReads = [];
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'listening-dictation@local', role: 'admin' });
  if (parsed.pathname === '/admin/listening/dictation-reports/aggregate' && method === 'GET') {
    aggregateQueries.push(parsed.search);
    if (parsed.searchParams.get('user_query') === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, 650));
      return json({ session_count: 1, mean_accuracy: .1, top_missed: [{ word: 'old aggregate', count: 1 }], top_wrong: [] });
    }
    if (parsed.searchParams.get('test_id') === 'agg-fail') return json({ detail: 'aggregate unavailable' }, 503);
    return json({ session_count: 3, mean_accuracy: .625, top_missed: [{ word: 'Brighton', count: 4 }, { word: '', count: 1 }], top_wrong: [{ expected: 'address', count: 2 }] });
  }
  if (parsed.pathname === '/admin/listening/dictation-reports' && method === 'GET') {
    listQueries.push(parsed.search);
    if (parsed.searchParams.get('user_query') === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, 650));
      return json({ items: [{ id: 'old-session', user_id: 'old-user', test_id_external: 'OLD', section_num: 1, total_sentences: 1, correct_count: 0, accuracy: .1, created_at: '2026-08-13T00:00:00Z', user: { id: 'old-user', email: 'old@example.com', display_name: 'Old response' } }], total: 1, limit: 50, offset: 0, association_lookup_failed: false, association_lookup_failures: [] });
    }
    const offset = Number(parsed.searchParams.get('offset') || 0);
    const row = { id: offset ? 'session-51' : 'session-1', user_id: 'user-1', test_id_external: parsed.searchParams.get('test_id') || 'C19-T1', section_num: 2, section_title: 'Section <script>', total_sentences: 4, correct_count: 3, accuracy: .875, total_time_seconds: 150, completed_at: '2026-08-14T00:02:30Z', created_at: '2026-08-14T00:00:00Z', user: { id: 'user-1', email: null, display_name: null } };
    const malformed = { ...row, id: 'bad', accuracy: 2 };
    return json({ items: offset ? [row] : [row, malformed], total: 75, limit: 50, offset, association_lookup_failed: true, association_lookup_failures: ['users'] });
  }
  if (parsed.pathname === '/admin/listening/dictation-reports/session-1' && method === 'GET') {
    detailReads.push(parsed.pathname);
    const sentence = { sentence_idx: 0, reference: 'The address is Brighton.', user_text: '<script>', score: .75, correct_words: 3, total_words: 4, listen_count: 2, time_seconds: 30, ops: { miss: 0, wrong: 1, extra: 0 } };
    return json({ id: 'session-1', user_id: 'user-1', test_id_external: 'C19-T1', section_num: 2, section_title: 'Section <script>', total_sentences: 4, correct_count: 3, accuracy: .875, total_words: 16, correct_words: 14, total_time_seconds: 150, completed_at: '2026-08-14T00:02:30Z', created_at: '2026-08-14T00:00:00Z', user: { id: 'user-1', email: 'learner@example.com', display_name: 'Learner <img>' }, results: [sentence, sentence, { ...sentence, sentence_idx: -1 }], error_trends: { op_counts: { miss: 1, wrong: 2, extra: 0 } }, association_lookup_failed: false, association_lookup_failures: [] });
  }
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/listening/dictation?user=slow`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Báo cáo chép chính tả' }).waitFor();
await page.getByRole('searchbox', { name: 'Học viên', exact: true }).fill('learner@example.com');
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.getByText('C19-T1', { exact: true }).waitFor();
check('admin gate và canonical list/aggregate dùng cùng filter', listQueries.some((query) => query.includes('user_query=learner%40example.com') && query.includes('limit=50')) && aggregateQueries.some((query) => query.includes('user_query=learner%40example.com') && !query.includes('limit=')), `${listQueries.join(' | ')} / ${aggregateQueries.join(' | ')}`);
await page.waitForTimeout(700);
check('response scope cũ không ghi đè list hoặc aggregate mới', await page.getByText('Old response', { exact: true }).count() === 0 && await page.getByText('old aggregate', { exact: true }).count() === 0 && await page.getByText('Brighton', { exact: true }).count() === 1);
check('malformed row/trend bị báo nhưng total backend được giữ', await page.getByText(/Đã loại 1 dòng/).count() === 1 && await page.getByText(/Đã loại 1 mục trend/).count() === 1 && await page.getByText(/75 phiên/).count() >= 1);
check('lookup failure hiện rõ, không giả thành association rỗng', await page.getByText('Lookup học viên thất bại', { exact: true }).count() === 1 && await page.getByText('⚠ Lookup failed', { exact: true }).count() === 1);
check('accuracy có chữ đi kèm, không chỉ dựa vào màu', await page.getByText('Cao', { exact: true }).count() >= 1 && await page.getByText('Đang cải thiện', { exact: true }).count() >= 1);
check('sidebar trỏ route native', await page.evaluate(() => [...(document.querySelector('aver-admin-chrome')?.shadowRoot?.querySelectorAll('a') || [])].find((link) => link.textContent?.includes('Báo cáo chép chính tả'))?.getAttribute('href') === '/admin/listening/dictation'));
check('rollback giữ filter học viên legacy hỗ trợ', await page.getByRole('link', { name: /Mở bản HTML rollback/ }).getAttribute('href') === '/pages/admin/listening/dictation-reports.html?user=learner%40example.com');
check('mobile list không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.aldict-table thead')).display === 'none' && document.documentElement.scrollWidth <= innerWidth));

await page.getByRole('button', { name: 'Xem từng câu' }).click();
await page.getByRole('heading', { name: 'Chi tiết phiên chép chính tả' }).waitFor();
check('detail dùng exact identity và ghi session vào URL', detailReads.length === 1 && new URL(page.url()).searchParams.get('session') === 'session-1');
check('câu chuẩn và câu học viên gõ được React escape', await page.getByText('The address is Brighton.', { exact: true }).count() === 1 && await page.getByText('<script>', { exact: true }).count() === 1 && await page.locator('script').filter({ hasText: '<script>' }).count() === 0);
check('duplicate/malformed sentence được báo riêng', await page.getByText(/Đã loại 2 câu sai hoặc trùng contract/).count() === 1);
check('detail báo thiếu evidence so với total canonical', await page.getByText(/Thiếu 3\/4 câu so với tổng canonical/).count() === 1);
await page.getByRole('button', { name: 'Đóng' }).click();
await page.waitForFunction(() => !new URL(location.href).searchParams.has('session'));

await page.getByRole('button', { name: 'Sau →' }).click();
await page.getByText('session-51', { exact: true }).waitFor();
check('pagination dùng canonical offset và URL page', listQueries.at(-1)?.includes('offset=50') === true && new URL(page.url()).searchParams.get('page') === '2');

await page.getByRole('searchbox', { name: 'Test ID' }).fill('agg-fail');
await page.getByRole('button', { name: 'Áp dụng' }).click();
await page.getByText('agg-fail', { exact: true }).waitFor();
await page.getByText('Không tải được tổng hợp', { exact: true }).waitFor();
check('aggregate lỗi không xóa list canonical độc lập', await page.getByText('agg-fail', { exact: true }).count() === 1 && await page.getByText('Không tải được danh sách', { exact: true }).count() === 0);

await page.setViewportSize({ width: 1440, height: 900 });
check('desktop tables không tràn trang', await page.evaluate(() => getComputedStyle(document.querySelector('.aldict-table thead')).display !== 'none' && document.documentElement.scrollWidth <= innerWidth));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening dictation flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
