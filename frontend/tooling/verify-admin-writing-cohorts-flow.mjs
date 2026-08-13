// Fixture-backed browser contract for native Admin Writing Cohorts.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000123';
const session = JSON.stringify({ access_token: 'admin-writing-cohorts-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-writing-cohorts@local' } });
const dangerous = '<img src=x onerror="window.__cohortXss=1">';
const requests = []; const errors = []; const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

let failDetail = false;
const list = { cohorts: [{ id: 'c1', name: dangerous, description: 'Khoá số 1', student_count: 2, active_assignments: 4, essays_pending: 1, essays_delivered: 1 }, { id: 'c2', name: 'Lớp chưa hoạt động', description: null, student_count: 1, active_assignments: 0, essays_pending: 0, essays_delivered: 0 }] };
const detail = { cohort: { id: 'c1', name: dangerous, description: 'Khoá số 1', student_count: 2 }, students: [{ id: 's1', full_name: 'Lan', student_code: 'S001' }, { id: 's2', full_name: 'Minh', student_code: 'S002' }], assignments: [
  { id: 'group:g1:prompt:p1', prompt_id: 'p1', group_id: 'g1', name: 'Buổi 1', title: 'Grammar map', task_type: 'task2', assigned_at: '2026-08-01T00:00:00Z' },
  { id: 'group:g2:prompt:p1', prompt_id: 'p1', group_id: 'g2', name: 'Buổi 2', title: 'Grammar map', task_type: 'task2', assigned_at: '2026-08-08T00:00:00Z' },
], matrix: { s1: {
  'group:g1:prompt:p1': { assignment_id: 'a1', status: 'delivered', essay_id: 'e1', deadline: null, updated_at: null, band: 7 },
  'group:g2:prompt:p1': { assignment_id: 'a2', status: 'submitted', essay_id: 'e2', deadline: '2026-08-10T00:00:00Z', updated_at: null, band: null },
}, s2: {
  'group:g1:prompt:p1': { assignment_id: 'a3', status: 'not_submitted', essay_id: null, deadline: '2026-08-20T00:00:00Z', updated_at: null, band: null },
} }, stats: { students: 2, assignments: 3, essays_pending: 1, essays_delivered: 1, overdue: 1 } };

const browser = await launch(); const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage(); page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const path = parsed.pathname; requests.push({ path, method: request.method() });
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (path === '/auth/me') return json({ id: adminId, email: 'admin-writing-cohorts@local', role: 'admin' });
  if (path === '/admin/writing/cohorts') return json(list);
  if (path === '/admin/writing/cohorts/c1') { if (failDetail) { failDetail = false; return json({ detail: 'fixture detail failure' }, 503); } return json(detail); }
  return json({ detail: `unhandled ${request.method()} ${path}` }, 500);
});

await page.goto(`${BASE}/admin/writing/cohorts?cohort=c1`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Tiến độ theo lớp' }).waitFor(); await page.getByText('Buổi 2', { exact: true }).waitFor();
check('admin gate và list/detail dùng canonical endpoints', requests.some((item) => item.path === '/auth/me') && requests.some((item) => item.path === '/admin/writing/cohorts') && requests.some((item) => item.path === '/admin/writing/cohorts/c1'));
check('tên lớp nguy hiểm hiển thị như text', await page.evaluate(() => window.__cohortXss !== 1));
check('hai lượt giao lại cùng prompt đều hiện riêng', await page.getByText('Grammar map', { exact: true }).count() === 2 && await page.getByText('Buổi 1', { exact: true }).count() === 1 && await page.getByText('Buổi 2', { exact: true }).count() === 1);
check('chỉ cell có essay id mở grade canonical', await page.getByRole('link', { name: /mở bài Writing/i }).count() === 2 && await page.getByRole('link', { name: /mở bài Writing/i }).first().getAttribute('href') === '/admin/writing/grade?essay_id=e1');
await page.getByLabel('Lọc trạng thái ô').selectOption('overdue');
await page.waitForFunction(() => new URL(location.href).searchParams.get('status') === 'overdue');
check('bộ lọc trạng thái được giữ trên URL', new URL(page.url()).searchParams.get('status') === 'overdue');
failDetail = true; await page.getByRole('button', { name: 'Làm mới canonical' }).click(); await page.getByText('Ma trận đang là snapshot cũ', { exact: true }).waitFor();
check('refresh lỗi giữ snapshot và gắn nhãn stale', await page.getByText('Buổi 2', { exact: true }).count() === 1);
await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ pageOverflow: document.documentElement.scrollWidth > innerWidth, tableScrollable: document.querySelector('.awc-table-wrap').scrollWidth > document.querySelector('.awc-table-wrap').clientWidth }));
check('mobile không tràn page và matrix tự cuộn ngang', !mobile.pageOverflow && mobile.tableScrollable, JSON.stringify(mobile));
check('không có browser alert/confirm và lỗi JS', errors.length === 0, errors.join(' | '));

await browser.close(); const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Writing Cohorts native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
