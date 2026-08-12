// Fixture-backed browser contract for the native Grammar admin hub.
// It validates auth, navigation, responsive layout and no business writes.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000110';
const fakeSession = JSON.stringify({ access_token: 'admin-grammar-not-a-real-token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-grammar@local' } });
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

await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  requests.push({ method, path: parsed.pathname });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) unexpectedWrites.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-grammar@local', role: 'admin' });
  return json({});
});

await page.goto(`${BASE}/admin/grammar`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Grammar workspace', exact: true }).waitFor({ state: 'visible' });
check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('hiển thị đúng file-based source of truth', await page.getByText('backend/content/<category>/<slug>.md', { exact: true }).count() === 1);
check('có đủ bốn workspace vận hành', await page.locator('.grh-card').count() === 4);
check('có learner preview canonical', await page.getByRole('link', { name: /Xem phía học viên/ }).getAttribute('href') === '/grammar');
check('mobile xếp một cột và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.grh-grid')).gridTemplateColumns.split(' ').length === 1 && document.documentElement.scrollWidth <= window.innerWidth));
check('toàn bộ card có focus target bằng anchor', await page.locator('a.grh-card[href]').count() === 4);

await page.setViewportSize({ width: 1440, height: 900 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Grammar workspace', exact: true }).waitFor({ state: 'visible' });
const desktop = await page.evaluate(() => ({
  columns: getComputedStyle(document.querySelector('.grh-grid')).gridTemplateColumns.split(' ').length,
  publishingColumns: getComputedStyle(document.querySelector('.grh-publishing')).gridTemplateColumns.split(' ').length,
  scrollWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
}));
check('desktop dùng lưới 2 cột và không tràn ngang', desktop.columns === 2 && desktop.publishingColumns === 2 && desktop.scrollWidth <= desktop.viewportWidth, JSON.stringify(desktop));

await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Grammar workspace', exact: true }).waitFor({ state: 'visible' });
check('dark mode vẫn có nền và chữ phân biệt', await page.evaluate(() => {
  const card = document.querySelector('.grh-card'); const style = getComputedStyle(card);
  return style.backgroundColor !== style.color && style.color !== 'rgba(0, 0, 0, 0)';
}));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Grammar hub flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
