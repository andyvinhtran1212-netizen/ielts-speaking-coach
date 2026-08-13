// Fixture-backed browser contract for the native, read-only Speaking admin hub.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000114';
const session = JSON.stringify({ access_token: 'admin-speaking-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-speaking@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

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
  const parsed = new URL(url); const method = request.method(); requests.push(`${method} ${parsed.pathname}`);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`)) writes.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-speaking@local', role: 'admin' });
  return json({});
});

await page.goto(`${BASE}/admin/speaking`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Speaking workspace', exact: true }).waitFor();
check('backend-owned admin gate chạy', requests.includes('GET /auth/me'));
check('learner preview là canonical route', await page.getByRole('link', { name: /Xem phía học viên/ }).getAttribute('href') === '/speaking');
check('ba workspace có full-card anchor', await page.locator('a.sph-card[href]').count() === 3);
check('Sessions native và Topics legacy hiển thị đúng ownership', await page.getByText('NATIVE', { exact: true }).count() >= 2 && await page.getByText('LEGACY WORKSPACE', { exact: true }).count() === 1);
check('mobile một cột và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.sph-grid')).gridTemplateColumns.split(' ').length === 1 && document.documentElement.scrollWidth <= innerWidth));

await page.setViewportSize({ width: 1440, height: 900 });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Speaking workspace', exact: true }).waitFor();
check('desktop ba cột và không tràn ngang', await page.evaluate(() => getComputedStyle(document.querySelector('.sph-grid')).gridTemplateColumns.split(' ').length === 3 && document.documentElement.scrollWidth <= innerWidth));
await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Speaking workspace', exact: true }).waitFor();
check('dark mode vẫn phân biệt card và text', await page.evaluate(() => { const style = getComputedStyle(document.querySelector('.sph-card')); return style.backgroundColor !== style.color && style.color !== 'rgba(0, 0, 0, 0)'; }));
check('không có write ngoài contract', writes.length === 0, writes.join(', '));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Speaking hub flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
