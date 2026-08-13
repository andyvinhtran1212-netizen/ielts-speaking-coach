// Fixture-backed browser contract for native Admin Writing Regrade Requests.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000123';
const session = JSON.stringify({ access_token: 'admin-writing-regrade-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-writing-regrade@local' } });
const results = []; const requests = []; const pageErrors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const dangerous = '<img src=x onerror="window.__regradeXss=1">';
const row = (overrides = {}) => ({ id: 'r1', essay_id: 'e1', student_id: 's1', reason: 'Em đã nêu đủ hai khía cạnh và muốn phần Task Response được kiểm tra lại kỹ hơn.', status: 'pending', student_name: dangerous, student_code: 'S001', cohort_name: 'A1', essay_task_type: 'task2', essay_prompt: 'Discuss whether cities should invest in public transport.', essay_status: 'delivered', essay_band: 6.5, admin_response: null, created_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z', actioned_at: null, fulfilled_at: null, ...overrides });
let rows = [row(), row({ id: 'r2', essay_id: 'e2', student_name: 'Lan', student_code: 'S002', status: 'rejected', admin_response: 'Band hiện tại đã đúng theo descriptor.' })];
let failNextList = false; let failNextAcceptedDetail = false;

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method(); const path = parsed.pathname;
  requests.push({ path, method, status: parsed.searchParams.get('status'), body: request.postDataJSON?.() });
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (path === '/auth/me') return json({ id: adminId, email: 'admin-writing-regrade@local', role: 'admin' });
  if (path === '/admin/writing/regrade-requests' && method === 'GET') {
    if (failNextList) { failNextList = false; return json({ detail: 'fixture list failure' }, 503); }
    const status = parsed.searchParams.get('status');
    return json({ requests: rows.filter((item) => !status || item.status === status), capped: false });
  }
  const match = path.match(/^\/admin\/writing\/regrade-requests\/([^/]+)$/);
  if (match) {
    const current = rows.find((item) => item.id === decodeURIComponent(match[1]));
    if (method === 'GET') {
      if (current?.id === 'r1' && current.status === 'accepted' && failNextAcceptedDetail) { failNextAcceptedDetail = false; return json({ detail: 'fixture readback failure' }, 503); }
      return current ? json(current) : json({ detail: 'not found' }, 404);
    }
    if (method === 'PATCH' && current) {
      const body = request.postDataJSON();
      current.status = body.action === 'accept' ? 'accepted' : 'rejected'; current.essay_status = body.action === 'accept' ? 'reviewed' : 'delivered'; current.admin_response = body.response || null;
      failNextAcceptedDetail = body.action === 'accept';
      return json(current);
    }
  }
  return json({ detail: `unhandled ${method} ${path}` }, 500);
});

await page.goto(`${BASE}/admin/writing/regrade-requests`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Yêu cầu chấm lại', exact: true }).waitFor();
await page.getByText(dangerous, { exact: true }).waitFor();
for (let attempt = 0; attempt < 40 && new Set(requests.filter((item) => item.path === '/admin/writing/regrade-requests' && item.method === 'GET').map((item) => item.status)).size < 4; attempt += 1) {
  await page.waitForTimeout(25);
}
check('admin gate và bốn lane canonical được tải riêng', requests.some((item) => item.path === '/auth/me') && new Set(requests.filter((item) => item.path === '/admin/writing/regrade-requests' && item.method === 'GET').map((item) => item.status)).size === 4);
check('hostile student name hiển thị như text', await page.evaluate(() => window.__regradeXss !== 1));

await page.getByRole('button', { name: 'Mở hồ sơ' }).click();
await page.getByRole('dialog').waitFor();
check('detail canonical được đọc trước khi mở quyết định', requests.some((item) => item.path === '/admin/writing/regrade-requests/r1' && item.method === 'GET'));
await page.getByRole('button', { name: 'Chấp nhận & mở chấm lại' }).click();
await page.getByText(/Quyết định đã được máy chủ xác nhận nhưng chưa đối chiếu xong/).waitFor();
check('ACK thành công nhưng readback lỗi không PATCH lần hai', requests.filter((item) => item.path === '/admin/writing/regrade-requests/r1' && item.method === 'PATCH').length === 1);
await page.getByRole('button', { name: 'Thử đối chiếu lại' }).click();
await page.getByText(/Đã chấp nhận atomically/).waitFor();
check('retry chỉ GET readback và trạng thái accepted canonical', requests.filter((item) => item.path === '/admin/writing/regrade-requests/r1' && item.method === 'PATCH').length === 1 && rows.find((item) => item.id === 'r1').status === 'accepted');
await page.getByRole('link', { name: 'Mở bài để chấm lại' }).waitFor();
check('next step trỏ native grade workspace', await page.getByRole('link', { name: 'Mở bài để chấm lại' }).getAttribute('href') === '/admin/writing/grade?essay_id=e1');
await page.getByRole('dialog').getByText('Đóng', { exact: true }).click();

await page.getByRole('button', { name: /Đã từ chối/ }).click();
await page.getByText('Lan').waitFor();
failNextList = true;
await page.getByRole('button', { name: 'Làm mới canonical' }).click();
await page.getByText('Snapshot cũ', { exact: true }).waitFor();
check('refresh lỗi giữ snapshot và gắn nhãn stale', await page.getByText('Lan').count() > 0);

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, columns: getComputedStyle(document.querySelector('.awr-card')).gridTemplateColumns.split(' ').length }));
check('mobile một cột và không tràn viewport', !mobile.overflow && mobile.columns === 1, JSON.stringify(mobile));
check('không có browser confirm/alert', await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length === 0));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Writing Regrade native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
