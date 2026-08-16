// Fixture-backed browser contract for native `/admin/feedback`.
// All API calls are intercepted; production data is never read or mutated.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000096';
const fakeSession = JSON.stringify({ access_token: 'admin-feedback-not-a-real-token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-feedback@local' } });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
async function launchChromium() { try { return await chromium.launch(); } catch (error) { const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome }); throw error; } }

const dangerous = '<script>alert(1)</script><img src=x onerror=alert(2)>';
const sourceRows = [
  { id: '11111111-1111-1111-1111-111111111111', type: 'report', skill: 'reading', status: 'new', test_id: 'SHARED-01', q_num: 3, rating_de: null, rating_audio: null, category: 'wrong_answer', note: dangerous, created_by: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', anon_id: null, identity_kind: 'user', created_at: '2026-08-12T07:00:00Z' },
  { id: '22222222-2222-2222-2222-222222222222', type: 'flag', skill: 'listening', status: 'new', test_id: 'SHARED-01', q_num: 8, rating_de: null, rating_audio: null, category: null, note: 'Audio khác transcript', created_by: null, anon_id: 'redacted', identity_kind: 'anonymous', created_at: '2026-08-12T06:00:00Z' },
  { id: '33333333-3333-3333-3333-333333333333', type: 'rating', skill: 'listening', status: 'resolved', test_id: 'LIS-02', q_num: null, rating_de: 5, rating_audio: 4, category: null, note: 'Rất hữu ích', created_by: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', anon_id: null, identity_kind: 'user', created_at: '2026-08-11T06:00:00Z' },
];
let resolved = false;
let delayNextPatch = true;
let rollbackReadMode = 'complete';
let reads = 0;
const requests = [];
const unexpectedWrites = [];
const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (_) {} }, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request(); const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url); const method = request.method();
  requests.push({ method, path: parsed.pathname, search: parsed.search });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !(/^PATCH \/api\/admin\/feedback\/[^/]+$/.test(`${method} ${parsed.pathname}`) || /^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${parsed.pathname}`))) unexpectedWrites.push(`${method} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-feedback@local', role: 'admin' });
  if (parsed.pathname === '/api/admin/feedback' && method === 'GET') {
    reads += 1;
    const type = parsed.searchParams.get('type'); const skill = parsed.searchParams.get('skill'); const status = parsed.searchParams.get('status');
    if (rollbackReadMode === 'unavailable') return json({ data_status: 'unavailable', snapshot_to: '2026-08-12T08:00:00Z', skill: null, feedback_type: null, status: null, test_id: null, count: null, truncated: false, malformed_count: 0, items: [], groups: [] });
    if (rollbackReadMode === 'partial') return json({ data_status: 'partial', snapshot_to: '2026-08-12T08:00:00Z', skill: null, feedback_type: null, status: null, test_id: null, count: 1, truncated: true, malformed_count: 0, items: [sourceRows[0]], groups: [] });
    if (skill === 'vocabulary') return json({ data_status: 'unavailable', snapshot_to: '2026-08-12T08:00:00Z', skill, feedback_type: type, status, test_id: null, count: null, truncated: false, malformed_count: 0, items: [], groups: [] });
    let rows = sourceRows.map((row) => row.id === sourceRows[0].id && resolved ? { ...row, status: 'resolved' } : row);
    if (type) rows = rows.filter((row) => row.type === type);
    if (skill) rows = rows.filter((row) => row.skill === skill);
    if (status) rows = rows.filter((row) => row.status === status);
    return json({ data_status: type === 'flag' ? 'partial' : 'complete', snapshot_to: '2026-08-12T08:00:00Z', skill, feedback_type: type, status, test_id: null, count: rows.length, truncated: type === 'flag', malformed_count: 0, items: rows, groups: [] });
  }
  const match = parsed.pathname.match(/^\/api\/admin\/feedback\/([^/]+)$/);
  if (match && method === 'PATCH') {
    const body = request.postDataJSON();
    if (delayNextPatch) { delayNextPatch = false; await new Promise((resolve) => setTimeout(resolve, 150)); }
    resolved = body.status === 'resolved';
    return json({ id: decodeURIComponent(match[1]), status: body.status });
  }
  return json({});
});

await page.goto(`${BASE}/admin/feedback`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Phản hồi người học', exact: true }).waitFor({ state: 'visible' });
await page.getByText('SHARED-01', { exact: true }).first().waitFor({ state: 'visible' });
check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('mặc định server-filter trạng thái mới', requests.some((item) => item.path === '/api/admin/feedback' && item.search.includes('status=new')));
check('trùng test id khác skill vẫn là hai nhóm', await page.getByText('SHARED-01', { exact: true }).count() === 2);
check('nội dung độc hại được React escape', await page.locator('.afd-shell script, .afd-shell img, .afd-shell iframe').count() === 0 && await page.getByText(dangerous, { exact: true }).count() === 1);
check('mobile không tràn ngang và hành động đủ 44px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && (document.querySelector('.afd-item__action button')?.getBoundingClientRect().height || 0) >= 44));

const beforeMutationReads = reads;
await page.getByRole('button', { name: 'Đánh dấu đã xử lý' }).first().click();
await page.getByLabel('Trạng thái').selectOption('');
await page.getByText('Đã xử lý và đồng bộ từ máy chủ.', { exact: true }).waitFor({ state: 'visible' });
check('PATCH readback theo filter mới nhất khi filter đổi giữa mutation', requests.some((item) => item.method === 'PATCH' && item.path.endsWith(sourceRows[0].id)) && reads >= beforeMutationReads + 2 && new URL(page.url()).searchParams.get('status') === 'all' && await page.getByText(dangerous, { exact: true }).count() === 1);

await page.getByLabel('Trạng thái').selectOption('resolved');
await page.waitForURL((url) => url.searchParams.get('status') === 'resolved');
await page.waitForFunction(() => document.querySelector('select[aria-label="Trạng thái"]')?.value === 'resolved');
await page.getByText(dangerous, { exact: true }).waitFor({ state: 'visible' });
check(
  'filter nằm trên URL và reload được trạng thái resolved',
  new URL(page.url()).searchParams.get('status') === 'resolved' && requests.some((item) => item.path === '/api/admin/feedback' && item.search.includes('status=resolved')),
  `url=${page.url()} latest=${requests.filter((item) => item.path === '/api/admin/feedback').slice(-3).map((item) => item.search).join(' | ')}`,
);
await page.getByRole('button', { name: 'Mở lại' }).first().click();
await page.getByText('Đã mở lại và đồng bộ từ máy chủ.', { exact: true }).waitFor({ state: 'visible' });
check('mở lại cũng reload canonical và biến khỏi filter resolved', await page.getByText(dangerous, { exact: true }).count() === 0);

await page.getByLabel('Trạng thái').selectOption('');
await page.getByRole('button', { name: 'Flag bài giải' }).click();
await page.getByText('Danh sách chưa đầy đủ.', { exact: true }).waitFor({ state: 'visible' });
check('partial state dùng cận dưới', await page.getByText('≥ 1', { exact: true }).count() >= 1 && new URL(page.url()).searchParams.get('type') === 'flag');
check('partial state không kết luận điểm trung bình', await page.getByText('Không kết luận từ dữ liệu thiếu', { exact: true }).count() === 1);
await page.getByLabel('Kỹ năng').selectOption('vocabulary');
await page.getByText('Dữ liệu phản hồi hiện không khả dụng', { exact: true }).waitFor({ state: 'visible' });
check('unavailable không giả số 0', await page.getByText(/Không hiển thị số 0/).count() === 1);

await page.setViewportSize({ width: 1440, height: 900 });
await page.getByLabel('Kỹ năng').selectOption('');
const desktopFilterResponse = page.waitForResponse((response) => {
  const url = new URL(response.url());
  return url.pathname === '/api/admin/feedback'
    && !url.searchParams.get('type')
    && !url.searchParams.get('skill')
    && !url.searchParams.get('status');
});
await page.getByRole('button', { name: 'Tất cả' }).click();
await desktopFilterResponse;
await page.getByRole('heading', { name: 'Tất cả phản hồi', exact: true }).waitFor({ state: 'visible' });
await page.getByText('SHARED-01', { exact: true }).first().waitFor({ state: 'visible' });
const desktopLayout = await page.evaluate(() => {
  const header = document.querySelector('.afd-group__header');
  return {
    hasHeader: Boolean(header),
    display: header ? getComputedStyle(header).display : null,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  };
});
check('desktop giữ hierarchy nhóm và không tràn ngang', desktopLayout.hasHeader && desktopLayout.display === 'grid' && desktopLayout.scrollWidth <= desktopLayout.viewportWidth, JSON.stringify(desktopLayout));

rollbackReadMode = 'unavailable';
await page.goto(`${BASE}/pages/admin/feedback/index.html`, { waitUntil: 'domcontentloaded' });
await page.getByText(/không thể kết luận hộp thư đang trống/).waitFor({ state: 'visible' });
check('rollback first-page failure không giả thành hộp thư rỗng', await page.getByText('Chưa có feedback nào khớp bộ lọc.', { exact: true }).isHidden());

rollbackReadMode = 'partial';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText(/chỉ là cận dưới/).waitFor({ state: 'visible' });
const rollbackRows = page.locator('.fbx-row');
const rollbackRowCount = await rollbackRows.count();
const rollbackCountText = await page.locator('#fbx-count-n').textContent();
const rollbackRowText = rollbackRowCount ? await rollbackRows.first().textContent() : '';
check('rollback later-page failure giữ row và đánh dấu cận dưới', rollbackRowCount === 1 && rollbackRowText.includes(dangerous) && rollbackCountText === '≥ 1', `rows=${rollbackRowCount} count=${rollbackCountText}`);

check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Feedback native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
