// Fixture-backed browser contract for native Admin Listening tests inventory.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000120';
const session = JSON.stringify({ access_token: 'admin-listening-tests-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'listening-tests@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

let status = 'draft'; let examOnly = false; let listReads = 0; let detailReads = 0;
const writes = []; const errors = []; const listQueries = [];
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'listening-tests@local', role: 'admin' });
  if (parsed.pathname === '/admin/listening/tests' && method === 'GET') {
    listReads += 1; listQueries.push(parsed.search);
    const row = { id: 't1', test_id: 'ILR-LIS-001', title: 'Test <script>', status, test_type: 'full', exam_only: examOnly, section_count: 4, audio_ready_count: 3, band_target: 7, accent_profile: ['UK'], updated_at: '2026-08-14T00:00:00Z' };
    const malformed = { id: 'bad', test_id: 'BAD', title: 'Bad', status: 'draft', test_type: 'full', exam_only: null, section_count: 4, audio_ready_count: 4 };
    return json({ items: [row, malformed], total: 24, limit: 20, offset: 0 });
  }
  if (parsed.pathname === '/admin/listening/tests/t1/status' && method === 'PATCH') {
    writes.push({ path: parsed.pathname, body: request.postDataJSON() }); status = request.postDataJSON().status;
    return json({ id: 't1', status: 'archived' }); // stale ACK must never drive UI state
  }
  if (parsed.pathname === '/admin/listening/tests/t1' && method === 'PATCH') {
    writes.push({ path: parsed.pathname, body: request.postDataJSON() }); examOnly = request.postDataJSON().exam_only;
    return json({ id: 't1', exam_only: false }); // stale ACK
  }
  if (parsed.pathname === '/admin/listening/tests/t1' && method === 'GET') {
    detailReads += 1; await new Promise((resolve) => setTimeout(resolve, 450));
    return json({ id: 't1', test_id: 'ILR-LIS-001', title: 'Test detail', status, test_type: 'full', version: '1.0', band_target: 7, accent_profile: ['UK'], total_transcript_words: 2100, exam_only: examOnly, audio_assembly_mode: 'parts_only', full_audio_storage_path: null, assembled_audio_storage_path: null, cue_points: [], sections: [{ id: 'c1', section_num: 1, title: 'Section 1', status: 'draft', audio_storage_path: null, audio_ready: false, exercise_count: 1 }], plan_label_exercises: [], created_at: '2026-08-13T00:00:00Z', updated_at: '2026-08-14T00:00:00Z' });
  }
  if (parsed.pathname === '/admin/listening/tests/t1/audio/signed-urls' && method === 'GET') return json({ full: { audio_storage_path: null, signed_url: null }, assembled: { audio_storage_path: null, signed_url: null }, sections: [] });
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/listening/tests`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Kho test Listening' }).waitFor();
await page.getByText('ILR-LIS-001', { exact: true }).waitFor();
check('admin gate và query canonical chạy', listReads === 1 && listQueries[0].includes('status=all') && listQueries[0].includes('test_type=all'));
check('hostile title được React escape', await page.locator('script').filter({ hasText: 'Test' }).count() === 0 && await page.getByText('Test <script>', { exact: true }).count() === 1);
check('malformed row bị báo, total backend được giữ', await page.getByText(/Đã loại 1 dòng/).count() === 1 && await page.getByText(/24 test/).count() >= 1);
check('scope kỳ thi và rollback hiển thị rõ', await page.getByText('Thư viện luyện tập', { exact: true }).count() >= 1 && await page.getByRole('link', { name: 'Mở bản HTML rollback ↗' }).getAttribute('href') === '/pages/admin/listening/tests.html');
check('Sections đi tới native detail anchor', await page.getByRole('link', { name: 'Sections', exact: true }).getAttribute('href') === '/admin/listening/tests/t1#sections');
check('sidebar giữ route native', await page.evaluate(() => [...(document.querySelector('aver-admin-chrome')?.shadowRoot?.querySelectorAll('a') || [])].find((link) => link.textContent?.includes('Cambridge tests'))?.getAttribute('href') === '/admin/listening/tests'));
check('mobile cards không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.alt-table thead')).display === 'none' && document.documentElement.scrollWidth <= innerWidth));

await page.getByRole('button', { name: 'Phát hành', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận thay đổi' }).click();
await page.waitForTimeout(120);
check('stale PATCH ACK không đổi UI trước GET', await page.getByText('Bản nháp', { exact: true }).count() >= 1 && detailReads === 1);
await page.getByText('Đã đối chiếu backend: Đã phát hành.', { exact: true }).waitFor();
check('status chỉ đổi sau canonical readback + list refresh', writes[0].body.status === 'published' && listReads === 2 && await page.getByText('Đã phát hành', { exact: true }).count() >= 1);

await page.getByRole('button', { name: 'Dành cho kỳ thi', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận thay đổi' }).click();
await page.getByText(/chỉ dùng cho kỳ thi/).waitFor();
check('exam-only cũng có exact GET readback', writes[1].body.exam_only === true && detailReads === 2 && listReads === 3 && await page.getByText('Đề kỳ thi', { exact: true }).count() >= 2);

await page.setViewportSize({ width: 1440, height: 900 });
check('desktop table không tràn trang', await page.evaluate(() => getComputedStyle(document.querySelector('.alt-table thead')).display !== 'none' && document.documentElement.scrollWidth <= innerWidth));
await page.getByRole('link', { name: 'Sections', exact: true }).click();
await page.waitForURL(`${BASE}/admin/listening/tests/t1#sections`);
await page.locator('#sections').waitFor();
await page.waitForFunction(() => {
  const target = document.getElementById('sections');
  return target && target.getBoundingClientRect().top >= 0 && target.getBoundingClientRect().top < innerHeight;
});
check('click Sections tới native detail và scroll sau khi dữ liệu render', await page.evaluate(() => location.hash === '#sections' && document.getElementById('sections')?.getBoundingClientRect().top < innerHeight));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening tests flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
