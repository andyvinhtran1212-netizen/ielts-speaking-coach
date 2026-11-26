// Fixture-backed browser contract for native Admin Writing Regrade Requests.
// G09-T39 (ADMINIA-0074 FR-062): lanes Mới / Đang chấm lại / Đã trả lời, overdue
// against regrade_hours, three decisions ("Giữ nguyên điểm" needs 40 characters,
// "Chấm lại bằng AI" goes through a cost warning), the no-deduct line, and
// answered requests read-only.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';
import { stubAdminMfaStatus } from './admin-mfa-stub.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000123';
const session = JSON.stringify({ access_token: 'admin-writing-regrade-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-writing-regrade@local' } });
const results = []; const requests = []; const pageErrors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launch() { try { return await chromium.launch(); } catch (error) { const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome }); throw error; } }

const dangerous = '<img src=x onerror="window.__regradeXss=1">';
const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();
const row = (overrides = {}) => ({ id: 'r1', essay_id: 'e1', student_id: 's1', reason: 'Em đã nêu đủ hai khía cạnh.\nMong phần Task Response được kiểm tra lại kỹ hơn.', status: 'pending', student_name: dangerous, student_code: 'S001', cohort_name: 'A1', essay_task_type: 'task2', essay_prompt: 'Discuss whether cities should invest in public transport.', essay_status: 'delivered', essay_band: 6.5, admin_response: null, created_at: hoursAgo(50), updated_at: hoursAgo(50), actioned_at: null, fulfilled_at: null, ...overrides });
let rows = [
  row(),
  row({ id: 'r4', essay_id: 'e4', student_name: 'Minh', student_code: 'S004', created_at: hoursAgo(3) }),
  row({ id: 'r5', essay_id: 'e5', student_name: 'Hà', student_code: 'S005', created_at: hoursAgo(5) }),
  row({ id: 'r2', essay_id: 'e2', student_name: 'Lan', student_code: 'S002', status: 'rejected', admin_response: 'Band hiện tại đã đúng theo descriptor, phần lợi ích còn thiếu ví dụ.' }),
  row({ id: 'r3', essay_id: 'e3', student_name: 'Bình', student_code: 'S003', status: 'fulfilled', fulfilled_at: '2026-08-13T00:00:00Z' }),
];
let failNextList = false; let failNextAcceptedDetail = false;
let delayR2 = false; let releaseR2;

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
    return json({ requests: rows, capped: false, regrade_hours: 48, thresholds_failed: false });
  }
  if (/^\/admin\/writing\/essays\/[^/]+\/regrade$/.test(path) && method === 'POST') return json({ status: 'grading' }, 202);
  const match = path.match(/^\/admin\/writing\/regrade-requests\/([^/]+)$/);
  if (match) {
    const current = rows.find((item) => item.id === decodeURIComponent(match[1]));
    if (method === 'GET') {
      if (current?.id === 'r2' && delayR2) await new Promise((resolve) => { releaseR2 = resolve; });
      if (current?.id === 'r1' && current.status === 'accepted' && failNextAcceptedDetail) { failNextAcceptedDetail = false; return json({ detail: 'fixture readback failure' }, 503); }
      return current ? json(current) : json({ detail: 'not found' }, 404);
    }
    if (method === 'PATCH' && current) {
      const body = request.postDataJSON();
      if (body.action === 'reject' && String(body.response || '').trim().length < 40) return json({ detail: 'Giải thích gửi học viên cần ít nhất 40 ký tự.' }, 400);
      current.status = body.action === 'accept' ? 'accepted' : 'rejected'; current.essay_status = body.action === 'accept' ? 'reviewed' : 'delivered'; current.admin_response = body.response || null;
      failNextAcceptedDetail = body.action === 'accept' && current.id === 'r1';
      return json(current);
    }
  }
  return json({ detail: `unhandled ${method} ${path}` }, 500);
});
await stubAdminMfaStatus(page);
const dialog = () => page.getByRole('dialog');
const openRow = async (name) => { await page.locator('.awr-card', { hasText: name }).getByRole('button').click(); await dialog().waitFor(); };
const patches = (id) => requests.filter((item) => item.path === `/admin/writing/regrade-requests/${id}` && item.method === 'PATCH');

await page.goto(`${BASE}/admin/writing/regrade-requests`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Yêu cầu chấm lại', exact: true }).waitFor();
await page.getByText(dangerous, { exact: true }).waitFor();
const initialListReads = requests.filter((item) => item.path === '/admin/writing/regrade-requests' && item.method === 'GET');
check('admin gate và ba làn dùng chung một lần đọc danh sách', requests.some((item) => item.path === '/auth/me') && initialListReads.length >= 1 && initialListReads.every((item) => item.status === null));
const tabs = await page.getByRole('navigation', { name: 'Trạng thái yêu cầu' }).getByRole('button').allInnerTexts();
check('ba làn FR-062: Mới, Đang chấm lại, Đã trả lời', tabs.length === 3 && /Mới[\s\S]*3/.test(tabs[0]) && /Đang chấm lại[\s\S]*0/.test(tabs[1]) && /Đã trả lời[\s\S]*2/.test(tabs[2]), JSON.stringify(tabs));
check('hostile student name hiển thị như text', await page.evaluate(() => window.__regradeXss !== 1));
check('quá regrade_hours thì ghi quá hạn, chờ lâu nhất trước', await page.locator('.awr-card').first().getByText('Đã chờ 2 ngày · quá hạn').count() === 1 && await page.locator('.awr-card.is-overdue').count() === 1);

// Giữ nguyên điểm: disabled under 40 characters, then a reject, then read-only.
await openRow('S004');
check('detail được đọc trước khi mở quyết định', requests.some((item) => item.path === '/admin/writing/regrade-requests/r4' && item.method === 'GET'));
check('dòng "Không trừ lượt" luôn hiện', await dialog().getByText('Không trừ lượt chấm AI của học viên.', { exact: true }).count() === 1);
await dialog().getByLabel(/Giữ nguyên điểm/).check();
const keep = dialog().getByRole('button', { name: 'Gửi giải thích, giữ nguyên điểm' });
await dialog().getByRole('textbox', { name: /Giải thích gửi học viên/ }).fill('Quá ngắn để gửi.');
check('"Giữ nguyên điểm" tắt khi giải thích dưới 40 ký tự', await keep.isDisabled());
await dialog().getByRole('textbox', { name: /Giải thích gửi học viên/ }).fill('Bài nêu đủ hai mặt nhưng phần lợi ích chưa có ví dụ cụ thể.');
await keep.click();
await page.getByText(/điểm giữ nguyên/).waitFor();
check('giữ nguyên gửi reject kèm giải thích', patches('r4').length === 1 && patches('r4')[0].body?.action === 'reject' && patches('r4')[0].body?.response.length >= 40);
check('yêu cầu đã trả lời chỉ xem, không còn quyết định', await dialog().getByLabel(/Điều chỉnh điểm/).count() === 0 && await dialog().getByRole('button', { name: /Gửi giải thích/ }).count() === 0);
await dialog().locator('button.adm-btn-secondary', { hasText: 'Đóng' }).click();

// Chấm lại bằng AI: cost warning, accept, then the existing regrade route.
await openRow('S005');
await dialog().getByLabel(/Chấm lại bằng AI/).check();
check('hộp cảnh báo chi phí AI hiện trước khi gửi', await dialog().getByText('Cảnh báo · tốn chi phí AI', { exact: true }).count() === 1);
check('chưa gọi gì trước khi bấm chấp nhận chi phí', patches('r5').length === 0 && !requests.some((item) => item.path === '/admin/writing/essays/e5/regrade'));
await dialog().getByRole('button', { name: 'Chấm lại bằng AI, chấp nhận chi phí' }).click();
await page.getByText(/gửi bài cho AI chấm lại/).waitFor();
check('AI: accept rồi POST regrade của bài', patches('r5').length === 1 && patches('r5')[0].body?.action === 'accept' && requests.some((item) => item.path === '/admin/writing/essays/e5/regrade' && item.method === 'POST'));
check('sau khi nhận: chỉ còn "Mở màn chấm"', await dialog().getByRole('link', { name: 'Mở màn chấm' }).getAttribute('href') === '/admin/writing/grade?essay_id=e5');
await dialog().locator('button.adm-btn-secondary', { hasText: 'Đóng' }).click();

// Điều chỉnh điểm with a readback failure: one PATCH, retry only reads back.
await openRow('S001');
await dialog().getByLabel(/Điều chỉnh điểm/).check();
await dialog().getByRole('button', { name: 'Nhận yêu cầu và mở màn chấm' }).click();
await page.getByText(/Quyết định đã được máy chủ xác nhận nhưng chưa đọc lại xong/).waitFor();
check('ACK thành công nhưng đọc lại lỗi không PATCH lần hai', patches('r1').length === 1);
await dialog().getByRole('button', { name: 'Thử đọc lại' }).click();
await page.waitForURL(/\/admin\/writing\/grade\?essay_id=e1/, { timeout: 15000 }).catch(() => {});
check('đọc lại xong thì mở màn chấm của bài, vẫn một PATCH', patches('r1').length === 1 && rows.find((item) => item.id === 'r1').status === 'accepted' && /\/admin\/writing\/grade\?essay_id=e1/.test(page.url()), page.url());

await page.goto(`${BASE}/admin/writing/regrade-requests?status=rejected`, { waitUntil: 'domcontentloaded' });
await page.getByText('Lan').waitFor();
check('link cũ ?status=rejected mở làn Đã trả lời', await page.getByRole('button', { name: /Đã trả lời/ }).getAttribute('aria-current') === 'page');
failNextList = true;
await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
await page.getByText('Danh sách cũ', { exact: true }).waitFor();
check('tải lại lỗi giữ danh sách và gắn nhãn cũ', await page.getByText('Lan').count() > 0);

delayR2 = true;
await openRow('S002');
await dialog().locator('button.adm-btn-secondary', { hasText: 'Đóng' }).click();
await openRow('S003');
await dialog().getByText('Bình', { exact: true }).waitFor();
releaseR2();
await page.waitForTimeout(50);
check('detail cũ không mở lại hoặc ghi đè hồ sơ mới', await dialog().getByText('Bình', { exact: true }).count() === 1 && await dialog().getByText('Lan', { exact: true }).count() === 0);
await dialog().locator('button.adm-btn-secondary', { hasText: 'Đóng' }).click();

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, columns: getComputedStyle(document.querySelector('.awr-card')).gridTemplateColumns.split(' ').length }));
check('mobile một cột và không tràn viewport', !mobile.overflow && mobile.columns === 1, JSON.stringify(mobile));
check('không có browser confirm/alert', await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length === 0));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Writing Regrade native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
