// Fixture-backed browser contract for native Admin Listening content detail.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000119';
const session = JSON.stringify({ access_token: 'admin-listening-detail-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'listening-detail@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

let status = 'draft';
let contentReads = 0;
let exerciseReads = 0;
let parentReads = 0;
const writes = []; const errors = [];
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'listening-detail@local', role: 'admin' });
  if (parsed.pathname === '/admin/listening/content/c1' && method === 'GET') {
    contentReads += 1;
    return json({ id: 'c1', title: 'Detail <script>', status, source_type: 'upload_mp3', test_id: 't1', accent_tag: 'uk_rp', cefr_level: 'B2', ielts_section: 2, audio_duration_seconds: 75, audio_storage_path: null, audio_signed_url: null, transcript: 'Hostile <img onerror=alert(1)> stays text.', topic_tags: ['transport'], external_license: 'CC-BY', external_source_url: 'https://example.test/source', updated_at: '2026-08-14T00:00:00Z' });
  }
  if (parsed.pathname === '/admin/listening/exercises' && parsed.searchParams.get('content_id') === 'c1') {
    exerciseReads += 1;
    if (exerciseReads === 1) await new Promise((resolve) => setTimeout(resolve, 600));
    return json({ detail: 'exercise lookup unavailable' }, 503);
  }
  if (parsed.pathname === '/admin/listening/tests/t1') {
    parentReads += 1;
    if (parentReads === 1) await new Promise((resolve) => setTimeout(resolve, 600));
    return json({ id: 't1', test_id: 'IELTS-1', mode: 'full', full_audio_storage_path: 'tests/t1.mp3' });
  }
  if (parsed.pathname === '/admin/listening/content/c1/status' && method === 'PATCH') {
    writes.push({ method, path: parsed.pathname, body: request.postDataJSON() });
    if (request.postDataJSON().status === 'archived') return json({ detail: 'fixture mutation failed' }, 503);
    status = request.postDataJSON().status;
    return json({ id: 'c1', status: 'archived' }); // Deliberately stale: UI must ignore this and GET canonical truth.
  }
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/listening/content/c1`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Detail <script>', exact: true }).waitFor();
check('admin gate và identity GET đúng', contentReads === 1 && await page.getByText('c1', { exact: true }).count() >= 1);
check('hostile title và transcript được React escape', await page.locator('script').filter({ hasText: 'Detail' }).count() === 0 && await page.locator('img').count() === 0 && await page.getByText('Hostile <img onerror=alert(1)> stays text.', { exact: true }).count() === 1);
check('detail giữ rollback identity', await page.getByRole('link', { name: 'Mở bản HTML rollback ↗' }).getAttribute('href') === '/pages/admin/listening/content-detail.html?id=c1');
check('mobile detail không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

await page.getByRole('button', { name: 'Đã phát hành', exact: true }).click();
const dialog = page.getByRole('dialog');
await dialog.waitFor();
check('status mutation có dialog focus', await dialog.getAttribute('aria-modal') === 'true' && await dialog.evaluate((node) => node === document.activeElement));
await dialog.getByRole('button', { name: 'Xác nhận trạng thái' }).click();
await page.getByText('Đã đối chiếu backend: Đã phát hành.', { exact: true }).waitFor();
await page.getByText('Không đọc được exercise.', { exact: true }).waitFor();
check('PATCH payload đúng và chỉ một write', writes.length === 1 && writes[0].body.status === 'published');
check('UI chỉ xác nhận sau canonical GET readback', contentReads === 2 && await page.getByText('Đã đối chiếu backend: Đã phát hành.', { exact: true }).count() === 1);
check('pending reads được thay bằng canonical refresh', exerciseReads >= 2 && parentReads >= 2 && await page.getByText('Audio nằm ở test bundle', { exact: true }).count() === 1);
check('exercise 503 không làm mất metadata', await page.getByText('Accent / CEFR', { exact: true }).count() === 1 && await page.getByText(/lỗi này không có nghĩa “chưa có bài”/).count() === 1);

await page.getByRole('button', { name: 'Đã lưu trữ', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận trạng thái' }).click();
await page.getByText(/Không xác nhận được trạng thái canonical/).waitFor();
await page.waitForFunction(() => document.body.textContent?.includes('Không đọc được exercise.'));
check('PATCH lỗi vẫn tái đồng bộ mọi read', writes.length === 2 && contentReads === 3 && await page.getByRole('button', { name: 'Đã phát hành', exact: true }).isDisabled());

await page.setViewportSize({ width: 1440, height: 900 });
check('desktop detail không tràn trang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening content detail flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
