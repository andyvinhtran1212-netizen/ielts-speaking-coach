// Fixture-backed browser contract for native Admin Listening inventory.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000118';
const session = JSON.stringify({ access_token: 'admin-listening-content-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'listening-content@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const content = [
  { id: 'c1', title: 'City transport <script>', status: 'published', source_type: 'test_section', accent_tag: 'uk_rp', cefr_level: 'B2', ielts_section: 2, section_num: 2, audio_duration_seconds: 125, audio_storage_path: 'tests/c1.mp3', topic_tags: ['transport'], is_premium: false, updated_at: '2026-08-14T00:00:00Z' },
  { id: 'c2', test_id: 't1', title: 'Coastal lecture', status: 'published', source_type: 'test_section', accent_tag: 'au', cefr_level: 'C1', ielts_section: 4, audio_duration_seconds: 0, audio_storage_path: null, topic_tags: ['environment'], is_premium: true, created_at: '2026-08-13T00:00:00Z' },
  { id: '', title: 'Malformed', status: 'published' },
];
const exercises = {
  c1: [{ id: 'e1', content_id: 'c1', exercise_type: 'dictation', status: 'published' }, { id: 'e2', content_id: 'c1', exercise_type: 'gist', status: 'draft' }, { id: 'e3', content_id: 'c1', exercise_type: 'gist', status: 'published' }, { id: 'e4', content_id: 'c1', exercise_type: 'mini_test', status: 'published' }],
};
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
const requests = []; const writes = []; const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  requests.push(`${method} ${parsed.pathname}${parsed.search}`);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) writes.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'listening-content@local', role: 'admin' });
  if (parsed.pathname === '/admin/listening/content') return json({ items: content, total: 23, limit: 20, offset: 0 });
  if (parsed.pathname === '/admin/listening/tests/t1') return json({ id: 't1', audio_assembly_mode: 'full_premixed', full_audio_storage_path: 'tests/t1/full.mp3', assembled_audio_storage_path: null });
  if (parsed.pathname === '/admin/listening/exercises') {
    const id = parsed.searchParams.get('content_id');
    return id === 'c2' ? json({ detail: 'lookup failed' }, 503) : json({ exercises: exercises[id] || [] });
  }
  return json({ detail: `unhandled fixture ${method} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/admin/listening?status=published`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Kho nội dung Listening', exact: true }).waitFor();
await page.getByText('2/4 loại · 3 block · 1/4 published · 1 mini', { exact: true }).waitFor();
check('backend admin gate và canonical paging chạy', requests.includes('GET /auth/me') && requests.includes('GET /admin/listening/content?status=published&limit=20&offset=0'));
check('hostile title được React escape', await page.getByText('City transport <script>', { exact: true }).count() === 1 && await page.locator('script').filter({ hasText: 'City transport' }).count() === 0);
check('nhiều block và mini-test giữ canonical truth', await page.getByText('2/4 loại · 3 block · 1/4 published · 1 mini', { exact: true }).count() === 1);
check('test-section dùng audio parent bundle', requests.includes('GET /admin/listening/tests/t1') && await page.getByText('Ở test bundle', { exact: true }).count() === 1);
check('lookup lỗi không biến thành chưa có', await page.getByText('Không đọc được', { exact: true }).count() === 1 && await page.getByText('Không đồng nghĩa “chưa có”', { exact: true }).count() === 1);
check('malformed row được báo nhưng total server giữ nguyên', await page.getByText(/Đã loại 1 dòng/).count() === 1 && await page.getByText(/23 mục/).count() === 1);
check('filter ở URL và active state đúng', new URL(page.url()).searchParams.get('status') === 'published' && await page.getByRole('button', { name: 'Đã phát hành' }).getAttribute('aria-current') === 'page');
check('detail/editor giữ đúng identity', await page.getByRole('link', { name: 'Chi tiết' }).first().getAttribute('href') === '/pages/admin/listening/content-detail.html?id=c1' && await page.getByRole('link', { name: 'MCQ' }).first().getAttribute('href') === '/pages/admin/listening/mcq.html?content_id=c1');
check('mobile cards không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.alc-table thead')).display === 'none' && document.documentElement.scrollWidth <= innerWidth));

await page.setViewportSize({ width: 1440, height: 900 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Kho nội dung Listening', exact: true }).waitFor();
check('desktop table hiển thị và không tràn trang', await page.evaluate(() => getComputedStyle(document.querySelector('.alc-table thead')).display !== 'none' && document.documentElement.scrollWidth <= innerWidth));
await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Kho nội dung Listening', exact: true }).waitFor();
check('dark mode giữ surface và text phân biệt', await page.evaluate(() => { const node = document.querySelector('.alc-library'); const style = getComputedStyle(node); return style.backgroundColor !== style.color && style.color !== 'rgba(0, 0, 0, 0)'; }));
check('inventory không phát sinh write', writes.length === 0, writes.join(', '));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Listening content flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
