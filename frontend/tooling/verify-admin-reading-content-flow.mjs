import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000116';
const session = JSON.stringify({ access_token: 'admin-reading-content-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'reading-content@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const item = { id: 'uuid-r1', slug: 'AVR-READ-001', library: 'l3_test', title: 'Academic Test 1', status: 'published', difficulty_level: 'academic', skill_focus: '60 phút · 40 câu', topic_tags: [], exam_only: false, locked: false, share_active: false, share_expires_at: null, updated_at: '2026-08-13T08:00:00Z', created_at: '2026-08-12T08:00:00Z' };
const list = () => ({ items: [item], total: 1, limit: 25, offset: 0 });
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
  const parsed = new URL(url); const method = request.method(); requests.push(`${method} ${parsed.pathname}${parsed.search}`);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) writes.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'reading-content@local', role: 'admin' });
  if (parsed.pathname === '/admin/reading/content') {
    const limit = Number(parsed.searchParams.get('limit') || 25); const offset = Number(parsed.searchParams.get('offset') || 0);
    if (parsed.searchParams.has('identity')) return json({ items: [item], total: 1, limit, offset });
    return json({ ...list(), limit, offset, items: offset ? [] : [item] });
  }
  if (parsed.pathname.endsWith('/exam-only') && method === 'POST') { item.exam_only = true; return json({ test_id: item.slug, exam_only: true }); }
  return json({});
});

await page.goto(`${BASE}/admin/reading/content`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Thư viện nội dung Reading', exact: true }).waitFor();
check('backend-owned admin gate chạy', requests.some((value) => value.startsWith('GET /auth/me')));
check('canonical list đọc page 25', requests.includes('GET /admin/reading/content?limit=25&offset=0'));
check('row và action L3 render đúng', await page.getByText('Academic Test 1', { exact: true }).count() === 1 && await page.getByRole('button', { name: 'Dành cho kỳ thi' }).count() === 1);
check('rollback preview giữ đường dẫn trực tiếp', (await page.getByRole('link', { name: 'Xem trước' }).getAttribute('href'))?.startsWith('/pages/admin/reading/preview.html?test_id=') === true);
check('mobile card-table không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && getComputedStyle(document.querySelector('.arc-table thead')).display === 'none'));

await page.getByRole('button', { name: 'Dành cho kỳ thi' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
await page.getByText('Đã giữ riêng đề cho kỳ thi.', { exact: true }).waitFor();
check('mutation exam-only đúng endpoint', writes.includes('POST /admin/reading/content/tests/AVR-READ-001/exam-only'));
check('sau write có canonical readback riêng rồi reload', requests.filter((value) => value.startsWith('GET /admin/reading/content?')).length >= 3);

await page.setViewportSize({ width: 1440, height: 900 }); await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Thư viện nội dung Reading', exact: true }).waitFor();
check('desktop import chia hai cột', await page.evaluate(() => getComputedStyle(document.querySelector('.arc-import-grid')).gridTemplateColumns.split(' ').length === 2));
check('desktop không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Thư viện nội dung Reading', exact: true }).waitFor();
check('dark mode giữ tương phản surface', await page.evaluate(() => { const node = document.querySelector('.arc-library'); const style = getComputedStyle(node); return style.backgroundColor !== style.color; }));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Reading content flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
