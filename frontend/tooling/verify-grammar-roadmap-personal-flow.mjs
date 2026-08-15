// Fixture-backed browser verification for the authenticated half of the mixed
// `/grammar/roadmap` route. Public `?slug=` is covered by parity-diff.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3001';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const userId = '00000000-0000-0000-0000-000000000654';
const session = JSON.stringify({ access_token: 'roadmap-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: userId, email: 'roadmap@local' } });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
const errors = []; let mode = 'personal'; let authorization = '';
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/api/me/roadmap') {
    authorization = request.headers().authorization || '';
    if (mode === 'malformed') return json({ mode: 'personal', weak_count: 1, nodes: null });
    if (mode === 'static') return json({ mode: 'static', nodes: [] });
    return json({ mode: 'personal', weak_count: 1, nodes: [
      { slug: 'sentence-elements', category: null, title: 'Nền tảng chưa ánh xạ', status: 'unseen', is_weak: false },
      { slug: 'relative-clauses', category: 'clauses', title: 'Relative <img onerror=alert(1)>', status: 'weak', is_weak: true },
    ] });
  }
  return json({ detail: `unhandled fixture ${request.method()} ${parsed.pathname}` }, 404);
});

await page.goto(`${BASE}/grammar/roadmap`, { waitUntil: 'domcontentloaded' });
await page.getByText('Relative <img onerror=alert(1)>', { exact: true }).waitFor();
check('auth bearer và personal endpoint canonical', authorization === 'Bearer roadmap-not-real');
check('weak count + prerequisite order giữ từ backend',
  await page.locator('.kp-node').count() === 2
  && await page.locator('.kp-node').first().getByText('Nền tảng chưa ánh xạ', { exact: true }).count() === 1
  && await page.getByText('1 điểm cần luyện — củng cố nền tảng trước, rồi tới điểm yếu.', { exact: true }).count() === 1);
check('authored title được React escape', await page.locator('img[onerror]').count() === 0);
check('node thiếu category không bịa link', await page.locator('.kp-node').first().evaluate((el) => el.tagName) === 'DIV');
check('node hợp lệ dùng article URL sạch', await page.locator('a.kp-node').getAttribute('href') === '/grammar/clauses/relative-clauses');
check('mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

mode = 'malformed';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('Không tải được lộ trình', { exact: true }).waitFor();
check('payload hỏng hiện lỗi, không giả trạng thái rỗng', await page.getByText('Chưa có lộ trình cá nhân', { exact: true }).count() === 0);

mode = 'static';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('Chưa có lộ trình cá nhân', { exact: true }).waitFor();
check('static canonical mới hiện empty state', await page.getByText('Không tải được lộ trình', { exact: true }).count() === 0);
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
check('không có lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = checks.filter((item) => !item.ok);
console.log(`\nGrammar Roadmap personal flow: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
