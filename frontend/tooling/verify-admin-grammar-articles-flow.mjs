// Fixture-backed browser contract for native Grammar Articles inventory.
// All backend calls are intercepted; production content and analytics are untouched.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000111';
const fakeSession = JSON.stringify({ access_token: 'admin-grammar-articles-not-a-real-token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-grammar-articles@local' } });
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
let partialMetrics = false;

const articles = [
  { slug: 'past-perfect', title: 'Past <script>alert(1)</script> Perfect', category: 'tenses', summary: 'Canonical summary', band: 7, view_count: 120, save_count: 9, source_path: ['backend', 'content', 'tenses', 'past-perfect.md'].join('/') },
  { slug: 'modal-verbs', title: 'Modal verbs', category: 'verb-patterns', summary: 'Hedging and stance', band: 6.5, view_count: 80, save_count: 4, source_path: ['backend', 'content', 'verb-patterns', 'modal-verbs.md'].join('/') },
];

await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  requests.push({ method, path: parsed.pathname, search: parsed.search });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) unexpectedWrites.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-grammar-articles@local', role: 'admin' });
  if (parsed.pathname === '/admin/grammar/articles') {
    if (refreshFails) { refreshFails = false; return json({ detail: 'content source unavailable' }, 503); }
    const category = parsed.searchParams.get('category'); const search = (parsed.searchParams.get('search') || '').toLowerCase();
    const rows = articles.filter((row) => (!category || row.category === category) && (!search || `${row.title} ${row.slug}`.toLowerCase().includes(search))).map((row) => partialMetrics ? { ...row, view_count: null } : row);
    return json({ items: rows, total: rows.length, available_total: articles.length, categories: ['tenses', 'verb-patterns'], analytics_status: { views: partialMetrics ? 'unavailable' : 'complete', saves: 'complete' } });
  }
  if (parsed.pathname.endsWith('/preview')) {
    const slug = decodeURIComponent(parsed.pathname.split('/').at(-2));
    return json({ slug, html: '<h1>Rendered article</h1><script>window.top.__previewEscaped=false</script><p>Student-safe render.</p>' });
  }
  return json({});
});

await page.goto(`${BASE}/admin/grammar/articles`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Articles browser', exact: true }).waitFor({ state: 'visible' });
await page.getByText('Past <script>alert(1)</script> Perfect', { exact: true }).waitFor({ state: 'visible' });
check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('nội dung độc hại được React escape', await page.locator('.gaa-shell script').count() === 0);
check('mobile table thành card và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.gaa-table')).display === 'grid' && document.documentElement.scrollWidth <= window.innerWidth));
check('nguồn Markdown canonical được hiển thị', await page.getByText('backend/content/<category>/<slug>.md', { exact: true }).count() === 1);

await page.getByRole('button', { name: 'Xem trước' }).first().click();
await page.locator('iframe[title^="Preview Past"]').waitFor({ state: 'visible' });
check('preview dùng iframe sandbox không quyền script', await page.locator('iframe[title^="Preview Past"]').getAttribute('sandbox') === '');
check('student view dùng clean URL', await page.getByRole('link', { name: 'Mở student view ↗' }).getAttribute('href') === '/grammar/tenses/past-perfect');

await page.getByLabel('Danh mục').selectOption('verb-patterns');
await page.waitForURL((url) => url.searchParams.get('category') === 'verb-patterns');
await page.getByText('Modal verbs', { exact: true }).waitFor({ state: 'visible' });
check('filter được giữ trong URL và gọi canonical query', requests.some((item) => item.path === '/admin/grammar/articles' && item.search === '?category=verb-patterns'));

refreshFails = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Không thể làm mới — đang giữ danh sách trước đó.', { exact: true }).waitFor({ state: 'visible' });
check('refresh lỗi giữ snapshot cũ', await page.getByText('Modal verbs', { exact: true }).count() === 1);

partialMetrics = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Một phần số liệu sử dụng không khả dụng.', { exact: true }).waitFor({ state: 'visible' });
check('metric lỗi hiển thị unknown, không phải zero', await page.locator('td[data-label="Views"]').filter({ hasText: '—' }).count() === 1 && await page.getByText(/Dấu — không có nghĩa là 0/).count() === 1);

await page.setViewportSize({ width: 1440, height: 900 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Articles browser', exact: true }).waitFor({ state: 'visible' });
check('desktop dùng bảng và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.gaa-table')).display === 'table' && document.documentElement.scrollWidth <= window.innerWidth));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Grammar Articles flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
