// Fixture-backed browser contract for native Admin Writing Queue operations.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000119';
const session = JSON.stringify({ access_token: 'admin-writing-queue-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-writing-queue@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const dangerous = '<img src=x onerror="window.__queueXss=1">';
const now = new Date();
const past = new Date(now.getTime() - 86400000).toISOString();
const recent = new Date(now.getTime() - 3600000).toISOString();
const base = (id, name, status, extra = {}) => ({ id, student_id: `s-${id}`, student_full_name: name, student_code: id.toUpperCase(), task_type: 'task2', status, analysis_level: 3, selected_model: 'gemini-2.5-pro', word_count: 280, created_at: recent, delivered_at: null, error_message: null, sitting_id: null, grading_skipped_at: null, band: status === 'pending' || status === 'grading' ? null : 6.5, deadline: past, task1_image_missing: false, ...extra });
let regular = [base('e1', dangerous, 'reviewed'), base('e2', 'Learner Two', 'reviewed')];
let mockRows = [
  base('m1', 'Mock Short Grade', 'pending', { sitting_id: 'sit1', task_type: 'task1_academic', word_count: 120 }),
  base('m2', 'Mock Short Skip', 'pending', { sitting_id: 'sit2', task_type: 'task2', word_count: 180 }),
  base('m3', 'Mock Reviewed', 'graded', { sitting_id: 'sit3', word_count: 270 }),
];
let failNextRegularRead = false;
let listReads = 0;
const requests = []; const unexpectedWrites = []; const pageErrors = [];

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method(); const key = `${method} ${parsed.pathname}`;
  requests.push({ method, path: parsed.pathname, search: parsed.search });
  const allowedWrites = [/^POST \/admin\/writing\/essays\/bulk-mark-delivered$/, /^POST \/admin\/writing\/essays\/[^/]+\/start-grading$/, /^POST \/admin\/mock-exams\/writing\/essays\/[^/]+\/skip-grading$/, /^POST \/api\/(analytics\/events|error-logs)$/];
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !allowedWrites.some((pattern) => pattern.test(key))) unexpectedWrites.push(key);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-writing-queue@local', role: 'admin' });
  if (method === 'GET' && parsed.pathname === '/admin/cohorts') return json({ cohorts: [{ id: 'c1', name: 'Khoá 1' }, { id: 'c2', name: dangerous }, { id: '', name: 'malformed' }] });
  if (method === 'GET' && parsed.pathname === '/admin/writing/essays') {
    listReads += 1;
    const mock = parsed.searchParams.get('mock') === 'true';
    if (!mock && failNextRegularRead) { failNextRegularRead = false; return json({ detail: 'fixture refresh failed' }, 503); }
    const status = parsed.searchParams.get('status');
    const rows = (mock ? mockRows : regular).filter((row) => !status || row.status === status);
    return json(rows);
  }
  if (method === 'POST' && parsed.pathname === '/admin/writing/essays/bulk-mark-delivered') {
    const body = request.postDataJSON(); const ids = body.essay_ids || [];
    regular = regular.map((row) => ids.includes(row.id) ? { ...row, status: 'delivered', delivered_at: now.toISOString() } : row);
    return json({ delivered: ids, skipped: [], delivered_count: ids.length, skipped_count: 0, method: 'google_docs_paste' });
  }
  const grade = parsed.pathname.match(/^\/admin\/writing\/essays\/([^/]+)\/start-grading$/);
  if (method === 'POST' && grade) {
    mockRows = mockRows.map((row) => row.id === grade[1] ? { ...row, status: 'grading' } : row);
    return json({ essay_id: grade[1], job_id: `job-${grade[1]}`, status: 'queued' }, 202);
  }
  const skip = parsed.pathname.match(/^\/admin\/mock-exams\/writing\/essays\/([^/]+)\/skip-grading$/);
  if (method === 'POST' && skip) {
    mockRows = mockRows.map((row) => row.id === skip[1] ? { ...row, grading_skipped_at: now.toISOString() } : row);
    return json({ ok: true, essay_id: skip[1], grading_skipped: true });
  }
  return json({});
});

await page.goto(`${BASE}/admin/writing/queue?status=reviewed`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Hàng chờ chấm', exact: true }).waitFor();
await page.getByText('Learner Two', { exact: true }).waitFor();
check('admin gate và reviewed lane dùng đúng canonical scope', requests.some((item) => item.path === '/auth/me') && requests.some((item) => item.path === '/admin/writing/essays' && item.search.includes('status=reviewed') && item.search.includes('mock=false')));
check('hostile API text được escape trong bảng và lớp', await page.locator('.awq-table img').count() === 0 && await page.locator('.awq-toolbar img').count() === 0 && await page.evaluate(() => !window.__queueXss));
check('malformed cohort không biến thành option và có cảnh báo', await page.getByRole('option').count() === 3 && await page.getByText(/1 lớp sai định dạng/).count() === 1);

await page.getByLabel('Chọn tất cả bài đang hiển thị').check();
await page.getByRole('button', { name: 'Trả bài đã chọn' }).click();
check('bulk action mở dialog có focus trap thay vì confirm()', await page.getByRole('dialog', { name: 'Trả 2 bài cho học viên?' }).count() === 1);
const readsBeforeBulk = listReads;
await page.getByRole('button', { name: 'Trả bài đã chọn' }).last().click();
await page.getByText('Đã trả 2 bài và đồng bộ lại từ máy chủ.', { exact: true }).waitFor();
check('bulk success chỉ hiện sau canonical readback', listReads > readsBeforeBulk && await page.getByText('Lane này đang trống', { exact: true }).count() === 1);

await page.getByRole('button', { name: /^Đã trả/ }).click();
await page.waitForURL((url) => url.searchParams.get('status') === 'delivered');
await page.getByText('Learner Two', { exact: true }).waitFor();
failNextRegularRead = true;
await page.getByRole('button', { name: 'Làm mới' }).click();
await page.getByText('Đang hiển thị snapshot gần nhất.', { exact: true }).waitFor();
check('refresh lỗi giữ snapshot đúng filter và báo dữ liệu cũ', await page.getByText('Learner Two', { exact: true }).count() === 1);

await page.getByRole('button', { name: /^Mock Writing/ }).click();
await page.waitForURL((url) => url.searchParams.get('mocklane') === '1');
await page.getByText('Mock Short Grade', { exact: true }).waitFor();
const gradeRow = page.locator('tr', { hasText: 'Mock Short Grade' });
await gradeRow.getByRole('button', { name: 'Chấm dù ngắn' }).click();
await page.getByRole('button', { name: 'Bắt đầu chấm' }).click();
await page.getByText('Đã đưa bài vào hàng chấm và đồng bộ lại từ máy chủ.', { exact: true }).waitFor();
check('grade-anyway được xác minh thành canonical grading', await gradeRow.getByText('Đang chấm', { exact: true }).count() === 1);

const skipRow = page.locator('tr', { hasText: 'Mock Short Skip' });
await skipRow.getByRole('button', { name: 'Bỏ qua' }).click();
await page.getByRole('button', { name: 'Bỏ qua chấm' }).click();
await page.getByText('Đã bỏ qua chấm bài ngắn và đồng bộ lại từ máy chủ.', { exact: true }).waitFor();
check('skip chỉ báo xong khi canonical skip stamp xuất hiện', await skipRow.getByText('Đã bỏ qua chấm', { exact: true }).count() === 1);

await page.setViewportSize({ width: 1440, height: 900 });
const desktop = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, lanes: getComputedStyle(document.querySelector('.awq-lanes')).gridTemplateColumns.split(' ').length, table: getComputedStyle(document.querySelector('.awq-table')).display }));
check('desktop giữ sáu lane, bảng và không tràn ngang', !desktop.overflow && desktop.lanes === 6 && desktop.table === 'table', JSON.stringify(desktop));
await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, row: getComputedStyle(document.querySelector('.awq-table tr')).display }));
check('mobile chuyển row thành card và không tràn viewport', !mobile.overflow && mobile.row === 'grid', JSON.stringify(mobile));
check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Writing Queue native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
