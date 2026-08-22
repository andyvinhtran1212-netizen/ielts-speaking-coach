// Fixture-backed browser contract for native Admin Writing Assignments.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000123';
const session = JSON.stringify({ access_token: 'admin-writing-assignments-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-writing-assignments@local' } });
const requests = []; const results = []; const pageErrors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const hostile = '<img src=x onerror="window.__assignmentXss=1">';
const assignment = (overrides = {}) => ({ id: 'a-old', status: 'pending', prompt_id: 'p1', student_id: 's1', assignment_group_id: 'g-old', name: hostile, deadline: null, instructions: null, created_at: '2026-08-13T00:00:00Z', submitted_at: null, graded_at: null, delivered_at: null, essay_id: null, allow_soft_check: false, is_timed: false, time_limit_minutes: null, auto_submitted: false, writing_prompts: { id: 'p1', title: 'Discuss public transport', task_type: 'task2', difficulty: 'intermediate' }, students: { id: 's1', student_code: 'S001', full_name: 'Lan' }, ...overrides });
let rows = [assignment()]; let cohortSourceFails = true; const committedRequests = new Map();

const browser = await launch(); const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage(); page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method(); const path = parsed.pathname;
  requests.push({ method, path, query: parsed.search, body: request.postDataJSON?.() });
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (path === '/auth/me') return json({ id: adminId, email: 'admin-writing-assignments@local', role: 'admin' });
  if (path === '/admin/writing/prompts' && method === 'GET') return json({ prompts: [{ id: 'p1', title: 'Discuss public transport', task_type: 'task2', difficulty: 'intermediate' }] });
  if (path === '/admin/writing/prompts/p-old' && method === 'GET') return json({ id: 'p-old', title: 'Prompt outside newest 500', task_type: 'task2', difficulty: 'advanced' });
  if (path === '/admin/students' && method === 'GET') return json(parsed.searchParams.get('offset') === '0' ? [{ id: 's1', full_name: 'Lan', student_code: 'S001', cohort_id: null }] : []);
  if (path === '/admin/students/s-old' && method === 'GET') return json({ id: 's-old', full_name: 'Học viên ngoài 2.000', student_code: 'S-OLD', cohort_id: null });
  if (path === '/admin/students/ghost' && method === 'GET') return json({ detail: 'not found' }, 404);
  if (path === '/admin/writing/cohorts' && method === 'GET') return cohortSourceFails ? json({ detail: 'fixture cohort source unavailable' }, 503) : json({ cohorts: [{ id: 'c1', name: 'Active class', student_count: 2 }] });
  if (path === '/admin/writing/cohorts/c1' && method === 'GET') return json({ detail: 'fixture cohort detail unavailable' }, 503);
  if (path === '/admin/writing/cohorts/c-old' && method === 'GET') return json({ cohort: { id: 'c-old', name: 'Archived class', student_count: 3 } });
  if (path === '/admin/writing/assignments' && method === 'GET') return json({ assignments: rows, capped: false });
  if (path === '/admin/writing/assignments' && method === 'POST') {
    const body = request.postDataJSON(); const existing = committedRequests.get(body.request_id);
    if (body.name === 'Invalid request') return json({ detail: 'fixture validation rejected' }, 422);
    if (existing) return json({ ...existing, replayed: true }, 201);
    const created = assignment({ id: 'a-new', assignment_group_id: 'g-new', name: body.name, allow_soft_check: body.allow_soft_check, is_timed: body.is_timed, time_limit_minutes: body.time_limit_minutes }); rows = [created, ...rows];
    committedRequests.set(body.request_id, { created: [{ id: 'a-new' }], count: 1, group_id: 'g-new', duplicates_warning: ['s1'] });
    return json({ detail: 'fixture response lost after commit' }, 503);
  }
  if (path.startsWith('/admin/writing/assignments/requests/') && method === 'GET') {
    const requestId = path.split('/').pop(); const receipt = committedRequests.get(requestId);
    return receipt ? json({ request_id: requestId, group_id: receipt.group_id, expected_count: receipt.count, assignment_ids: receipt.created.map((item) => item.id) }) : json({ detail: 'not found' }, 404);
  }
  return json({ detail: `unhandled ${method} ${path}` }, 500);
});

await page.goto(`${BASE}/admin/writing/assignments`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Bàn giao bài', exact: true }).waitFor(); await page.getByText(hostile, { exact: true }).waitFor();
check('admin gate và list dùng canonical endpoints', requests.some((item) => item.path === '/auth/me') && requests.some((item) => item.path === '/admin/writing/assignments' && item.method === 'GET'));
check('hostile group name hiển thị như text', await page.evaluate(() => window.__assignmentXss !== 1));

await page.getByRole('button', { name: 'Giao bài mới' }).click(); await page.getByRole('dialog').waitFor();
await page.getByText('Nguồn dữ liệu chưa sẵn sàng', { exact: true }).waitFor();
await page.getByText(/fixture cohort source unavailable/).waitFor();
check('lỗi cohort hiện riêng, prompt và student vẫn dùng được', await page.getByText('Discuss public transport', { exact: true }).count() > 0 && await page.getByText('Lan', { exact: true }).count() > 0);
const dialog = page.getByRole('dialog');
await dialog.getByText('Lan', { exact: true }).click(); await dialog.getByText('Discuss public transport', { exact: true }).click();
await dialog.getByLabel('Tên nhóm (tuỳ chọn)').fill('Buổi kiểm tra');
await dialog.getByRole('button', { name: 'Rà lại trước khi giao' }).click();
await dialog.getByText('1', { exact: true }).first().waitFor();
check('review hiển thị phép tính đề × học viên', await dialog.getByText('1', { exact: true }).count() >= 3 && await dialog.getByText('bài sẽ tạo', { exact: true }).count() === 1);
await dialog.getByRole('button', { name: 'Xác nhận giao 1 bài' }).click();
await dialog.getByText(/Chưa nhận được biên nhận hoàn chỉnh/).waitFor();
check('response mất sau commit giữ request idempotent để retry', requests.filter((item) => item.path === '/admin/writing/assignments' && item.method === 'POST').length === 1 && await page.evaluate((key) => Boolean(sessionStorage.getItem(key)), `awa-pending-request:${adminId}`));
const firstRequestId = requests.find((item) => item.path === '/admin/writing/assignments' && item.method === 'POST').body.request_id;
await dialog.getByRole('button', { name: 'Retry với cùng request_id' }).click();
const posts = requests.filter((item) => item.path === '/admin/writing/assignments' && item.method === 'POST');
check('retry POST dùng cùng request_id và backend chỉ tạo một nhóm', posts.length === 2 && posts.every((item) => item.body.request_id === firstRequestId) && rows.filter((item) => item.id === 'a-new').length === 1);
await page.getByText(/Đã giao và đối chiếu 1 bài/).waitFor();
check('replay ACK đối chiếu canonical và xoá cả pending states', requests.filter((item) => item.path === '/admin/writing/assignments' && item.method === 'POST').length === 2 && !await page.evaluate(([receiptKey, requestKey]) => sessionStorage.getItem(receiptKey) || sessionStorage.getItem(requestKey), [`awa-pending-receipt:${adminId}`, `awa-pending-request:${adminId}`]));

await page.getByRole('button', { name: 'Giao bài mới' }).click(); await page.getByRole('dialog').waitFor();
await dialog.getByText('Lan', { exact: true }).click(); await dialog.getByText('Discuss public transport', { exact: true }).click();
await dialog.getByLabel('Tên nhóm (tuỳ chọn)').fill('Invalid request'); await dialog.getByRole('button', { name: 'Rà lại trước khi giao' }).click();
await dialog.getByRole('button', { name: 'Xác nhận giao 1 bài' }).click(); await dialog.getByText(/Không có bài nào được tạo từ yêu cầu cũ/).waitFor();
check('422 chắc chắn chưa ghi mở lại form và xoá pending request', await dialog.getByRole('button', { name: 'Rà lại trước khi giao' }).count() === 1 && !await page.evaluate((key) => sessionStorage.getItem(key), `awa-pending-request:${adminId}`));

await dialog.getByRole('button', { name: 'Đóng' }).click();
const partialRequestId = '00000000-0000-4000-8000-000000000777';
const partialReceipt = { requestId: partialRequestId, assignmentIds: ['a-kept', 'a-deleted'], firstId: 'a-kept', groupId: 'g-partial', createdCount: 2, duplicateStudentIds: [] };
committedRequests.set(partialRequestId, { created: [{ id: 'a-kept' }], count: 2, group_id: 'g-partial', duplicates_warning: [] });
await page.evaluate(([key, value]) => sessionStorage.setItem(key, value), [`awa-pending-receipt:${adminId}`, JSON.stringify(partialReceipt)]);
await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('dialog').waitFor();
await page.getByRole('button', { name: 'Thử đối chiếu lại' }).click(); await page.getByText(/Chưa xác minh đủ mọi assignment/).waitFor();
check('thiếu non-first assignment giữ receipt chờ đối chiếu', Boolean(await page.evaluate((key) => sessionStorage.getItem(key), `awa-pending-receipt:${adminId}`)) && await page.getByRole('dialog').count() === 1);
await page.evaluate((key) => sessionStorage.removeItem(key), `awa-pending-receipt:${adminId}`); await page.reload({ waitUntil: 'domcontentloaded' });

await page.goto(`${BASE}/admin/writing/assignments?assign_student=s1&prompt_id=p1`, { waitUntil: 'domcontentloaded' });
const prefillDialog = page.getByRole('dialog'); await prefillDialog.waitFor();
const prefilledStudent = prefillDialog.locator('.awa-option').filter({ hasText: 'Lan' }).locator('input[type="checkbox"]');
const prefilledPrompt = prefillDialog.locator('.awa-option').filter({ hasText: 'Discuss public transport' }).locator('input[type="checkbox"]');
check('deep link chỉ chọn ID đã xác minh từ nguồn chuẩn', await prefilledStudent.isChecked() && await prefilledPrompt.isChecked());
await prefillDialog.getByRole('button', { name: 'Đóng' }).click();
await prefillDialog.waitFor({ state: 'hidden' });
await page.waitForFunction(() => !new URL(location.href).searchParams.has('assign_student') && !new URL(location.href).searchParams.has('prompt_id'), undefined, { timeout: 3000 }).catch(() => {});
check('đóng deep link dọn tham số chọn sẵn khỏi URL', !new URL(page.url()).searchParams.has('assign_student') && !new URL(page.url()).searchParams.has('prompt_id'), page.url());

await page.goto(`${BASE}/admin/writing/assignments?assign_student=s-old&prompt_id=p-old`, { waitUntil: 'domcontentloaded' });
const cappedFallbackDialog = page.getByRole('dialog'); await cappedFallbackDialog.waitFor();
const oldStudent = cappedFallbackDialog.locator('.awa-option').filter({ hasText: 'Học viên ngoài 2.000' }).locator('input[type="checkbox"]');
const oldPrompt = cappedFallbackDialog.locator('.awa-option').filter({ hasText: 'Prompt outside newest 500' }).locator('input[type="checkbox"]');
await oldStudent.waitFor(); await oldPrompt.waitFor();
check('ID ngoài snapshot giới hạn được xác minh qua detail endpoints', await oldStudent.isChecked() && await oldPrompt.isChecked() && requests.some((item) => item.path === '/admin/students/s-old') && requests.some((item) => item.path === '/admin/writing/prompts/p-old'));
await cappedFallbackDialog.getByRole('button', { name: 'Đóng' }).click(); await cappedFallbackDialog.waitFor({ state: 'hidden' });

await page.goto(`${BASE}/admin/writing/assignments?assign_student=s1&assign_cohort=c1&prompt_id=p1`, { waitUntil: 'domcontentloaded' });
const conflictDialog = page.getByRole('dialog'); await conflictDialog.waitFor();
await conflictDialog.getByText(/đồng thời học viên và lớp/).waitFor();
check('deep link xung đột không giữ ID chưa xác minh', await conflictDialog.locator('input[type="checkbox"]:checked').count() === 0);
await conflictDialog.getByRole('button', { name: 'Đóng' }).click(); await conflictDialog.waitFor({ state: 'hidden' });

await page.goto(`${BASE}/admin/writing/assignments?assign_cohort=c1&prompt_id=p1`, { waitUntil: 'domcontentloaded' });
const sourceErrorDialog = page.getByRole('dialog'); await sourceErrorDialog.waitFor();
await sourceErrorDialog.getByText(/Chưa thể xác minh lớp từ liên kết/).waitFor();
check('nguồn canonical lỗi không prefill một phần đối tượng hoặc đề', await sourceErrorDialog.locator('input[type="checkbox"]:checked').count() === 0);
await sourceErrorDialog.getByRole('button', { name: 'Đóng' }).click(); await sourceErrorDialog.waitFor({ state: 'hidden' });

cohortSourceFails = false;
await page.goto(`${BASE}/admin/writing/assignments?assign_cohort=c-old&prompt_id=p1`, { waitUntil: 'domcontentloaded' });
const archivedCohortDialog = page.getByRole('dialog'); await archivedCohortDialog.waitFor();
await archivedCohortDialog.getByRole('option', { name: /Archived class/ }).waitFor({ state: 'attached' });
check('lớp archive ngoài danh sách active được xác minh qua detail endpoint', await archivedCohortDialog.getByLabel('Lớp').inputValue() === 'c-old' && await archivedCohortDialog.locator('.awa-option').filter({ hasText: 'Discuss public transport' }).locator('input[type="checkbox"]').isChecked());
await archivedCohortDialog.getByRole('button', { name: 'Đóng' }).click(); await archivedCohortDialog.waitFor({ state: 'hidden' });

await page.goto(`${BASE}/admin/writing/assignments?assign_student=ghost&prompt_id=p1`, { waitUntil: 'domcontentloaded' });
const missingDialog = page.getByRole('dialog'); await missingDialog.waitFor();
await missingDialog.getByText(/Không tìm thấy học viên/).waitFor();
check('ID không tồn tại xoá toàn bộ prefill thay vì giữ riêng đề', await missingDialog.locator('input[type="checkbox"]:checked').count() === 0);
await missingDialog.getByRole('button', { name: 'Đóng' }).click(); await missingDialog.waitFor({ state: 'hidden' });

await page.setViewportSize({ width: 390, height: 844 }); await page.getByText('Buổi kiểm tra', { exact: true }).waitFor();
const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, columns: getComputedStyle(document.querySelector('.awa-row')).gridTemplateColumns.split(' ').length }));
check('mobile một cột và không tràn viewport', !mobile.overflow && mobile.columns === 1, JSON.stringify(mobile));
check('không có browser confirm/alert', !requests.some((item) => item.path.includes('confirm')));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close(); const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Writing Assignments native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
