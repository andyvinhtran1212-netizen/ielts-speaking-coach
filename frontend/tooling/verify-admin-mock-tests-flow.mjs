import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000181';
const session = JSON.stringify({ access_token: 'admin-mock-tests-not-real', refresh_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: adminId, email: 'admin-mock-tests@local' } });
const results = [];
const requests = [];
const errors = [];
const liveStudents = Array.from({ length: 18 }, (_, index) => ({
  user_id: `student-${index}`, sitting_id: `sitting-${index}`, student_name: `Học viên ${String(index + 1).padStart(2, '0')}`, started: true, in_roster: true, status: 'lrw_in_progress',
  sections: Object.fromEntries(['listening', 'reading', 'writing'].map((section) => [section, { state: section === 'listening' ? 'submitted' : section === 'reading' ? 'working' : 'waiting', answered: section === 'writing' ? 0 : 20, total: 40, last_activity_at: new Date().toISOString() }])),
}));
let liveOpen = true;
const exams = [
  { id: 'draft-1', code: 'MOCK-DRAFT', title: 'Đề đang soạn', status: 'draft', is_open: false, active_section: 'not_started', exam_mode: 'sequential' },
  { id: 'live-1', code: 'MOCK-LIVE', title: 'Đề đang thi', status: 'published', is_open: true, active_section: 'reading', exam_mode: 'sequential' },
  { id: 'closed-1', code: 'MOCK-CLOSED', title: 'Đề đã đóng', status: 'published', is_open: false, active_section: 'done', exam_mode: 'retake', review_eligible: true },
  { id: 'draft-1', code: 'DUPLICATE', status: 'draft' },
  { title: 'missing identity' },
];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
async function launch() {
  try { return await chromium.launch(); }
  catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true });
await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [storageKey(SB), session]);
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  const parsed = new URL(url);
  if (url.startsWith(BASE)) {
    if (/^\/pages\/admin\/mock-(?:exams|reviews)\//.test(parsed.pathname)) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>rollback fixture</title>' });
    }
    return route.continue();
  }
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  requests.push(`${request.method()} ${parsed.pathname}`);
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/admin/cohorts') return json({ cohorts: [] });
  if (parsed.pathname === '/admin/exam-content/page') return json({ items: [], total: 0, total_complete: true, levels: [], levels_complete: true, failed_level_kinds: [], failed_kinds: [] });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-mock-tests@local', role: 'admin' });
  if (parsed.pathname === '/admin/mock-exams') return json({ exams: exams.map((exam) => exam.id === 'live-1' ? { ...exam, is_open: liveOpen } : exam) });
  if (parsed.pathname === '/admin/mock-exams/live-1/live') return json({
    exam: { id: 'live-1', code: 'MOCK-LIVE', title: 'Đề đang thi', exam_mode: 'sequential', status: 'published', is_open: true, active_section: 'reading', collected_section: null, section_started_at: null, section_duration_seconds: 3600, section_time_left_seconds: 1200, configured_sections: ['listening', 'reading', 'writing'], cohort_id: null },
    roster: { expected: liveStudents.length, started: liveStudents.length, not_started: [], off_roster: [] },
    sections: { listening: { submitted: liveStudents.length, working: 0, absent: 0, missed: 0, expected: liveStudents.length }, reading: { submitted: 0, working: liveStudents.length, absent: 0, missed: 0, expected: liveStudents.length }, writing: { submitted: 0, working: 0, absent: 0, missed: 0, expected: liveStudents.length } },
    students: liveStudents, server_time: new Date().toISOString(),
  });
  if (parsed.pathname === '/admin/mock-exams/live-1/roster') return json({ roster: [] });
  if (parsed.pathname === '/admin/mock-exams/live-1/retest-summary') return json({ total_sittings: 0, reviewed_sittings: 0, needs_retest_count: 0, per_skill: { listening: 0, reading: 0, writing: 0, speaking: 0 }, students: [] });
  return json({ detail: 'unhandled fixture route' }, 500);
});

await page.goto(`${BASE}/admin/mock-tests?tab=live`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Trung tâm vận hành Mock Test' }).waitFor();
await page.getByText('2 đề sai contract đã bị loại').waitFor();
if (process.env.CAPTURE_UI) await page.screenshot({ path: '/tmp/admin-mock-tests-redesign.png', fullPage: true });
check('backend-owned admin gate và canonical exam list chạy', requests.includes('GET /auth/me') && requests.includes('GET /admin/mock-exams'));
await page.locator('iframe').waitFor();
check('deep-link Live tự chọn đúng phòng đang mở', (await page.locator('iframe').getAttribute('src')) === '/admin/mock-live?exam_id=live-1&embed=1' && await page.getByRole('button', { name: /MOCK-DRAFT/ }).count() === 0);
await page.waitForFunction(() => {
  const frame = document.querySelector('iframe');
  return frame?.contentWindow?.location.pathname === '/admin/mock-live'
    && frame.contentDocument?.readyState === 'complete';
});
const liveFrame = page.frameLocator('iframe.mts-frame');
await liveFrame.getByText('Học viên 18', { exact: true }).waitFor();
check('Live dài giữ đủ học viên trong bảng có cuộn', await liveFrame.locator('.mlv-table tbody tr').count() === liveStudents.length);
if (process.env.CAPTURE_UI) await page.screenshot({ path: '/private/tmp/mock-layout-live-desktop.png', fullPage: true });

// The real theme toggle persists the preference before updating the parent.
// Without that step, the iframe's anti-flash bootstrap can restore light.
await page.evaluate(() => {
  localStorage.setItem('av-theme', 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.documentElement?.getAttribute('data-theme') === 'dark');
check('theme parent được đồng bộ sang workspace native', await page.locator('iframe').evaluate((node) => node.contentDocument?.documentElement?.getAttribute('data-theme') === 'dark'));

await page.getByRole('button', { name: 'Đang thi', exact: true }).click();
check('stage filter giữ canonical total và đúng một live exam', await page.getByText('1/3', { exact: true }).count() === 1 && await page.getByRole('button', { name: /MOCK-LIVE/ }).count() === 1 && await page.getByRole('button', { name: /MOCK-DRAFT/ }).count() === 0);
await page.getByRole('button', { name: 'Đã đóng', exact: true }).click();
check('lọc không tự đổi đề đang thao tác', await page.getByText('Đề đang thao tác bị ẩn bởi bộ lọc').count() === 1 && (await page.locator('iframe').getAttribute('src'))?.includes('exam_id=live-1'));

await page.getByRole('tab', { name: /Nhận & chấm bài/ }).click();
await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.location.pathname === '/admin/mock-reviews');
check('Review tự chuyển sang đề đã đóng phù hợp ngữ cảnh', new URL(page.url()).searchParams.get('tab') === 'review' && (await page.locator('iframe').getAttribute('src')) === '/admin/mock-reviews?mock_exam_id=closed-1&embed=1' && await page.getByText('MODULE ROLLBACK').count() === 0);
await page.getByRole('tab', { name: /Phòng thi live/ }).click();
await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.location.pathname === '/admin/mock-live');
check('đổi Review sang Live loại đề đã đóng khỏi selection', new URL(page.url()).searchParams.get('exam_id') === 'live-1' && (await page.locator('iframe').getAttribute('src')) === '/admin/mock-live?exam_id=live-1&embed=1');
await page.getByRole('tab', { name: /Nhận & chấm bài/ }).click();
await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.location.pathname === '/admin/mock-reviews');
check('đổi Live sang Review loại phòng đang mở khỏi selection', new URL(page.url()).searchParams.get('exam_id') === 'closed-1' && (await page.locator('iframe').getAttribute('src')) === '/admin/mock-reviews?mock_exam_id=closed-1&embed=1');

await page.getByRole('tab', { name: 'Chấm Writing' }).click();
check('Writing dùng native queue và bỏ rail đề không liên quan', (await page.locator('iframe').getAttribute('src')) === '/admin/writing/queue?embed=1&mocklane=1' && await page.locator('.mts-rail').count() === 0);
await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.location.pathname === '/admin/writing/queue');
check('fixture đã đi sâu khỏi Writing queue', await page.locator('iframe').evaluate((node) => {
  node.contentWindow.history.pushState({}, '', '/admin/writing/grade?essay_id=fixture-child');
  return node.contentWindow.location.pathname === '/admin/writing/grade';
}));
await page.getByRole('tab', { name: 'Chấm Writing' }).click();
await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.location.pathname === '/admin/writing/queue');
check('bấm lại tab hiện tại trả iframe về workspace gốc', await page.locator('iframe').evaluate((node) => node.contentWindow.location.pathname === '/admin/writing/queue'));

await page.getByRole('tab', { name: 'Chấm Writing' }).press('Home');
check('tablist hỗ trợ Home/End/arrow mà không tự kích hoạt iframe', await page.getByRole('tab', { name: /Quản lý & giao đề/ }).evaluate((node) => node === document.activeElement) && new URL(page.url()).searchParams.get('tab') === 'writing');

await page.getByRole('tab', { name: /Quản lý & giao đề/ }).click();
await page.locator('iframe[src="/admin/mock-exams?embed=1"]').waitFor();
check('Manage đã nhúng route Next.js native, không còn rollback HTML', (await page.locator('iframe').getAttribute('src')) === '/admin/mock-exams?embed=1' && await page.getByText('MODULE ROLLBACK').count() === 0);

const manageFrame = page.frameLocator('iframe.mts-frame');
await manageFrame.getByRole('link', { name: 'Phòng thi trực tiếp', exact: true }).first().waitFor();
await manageFrame.getByRole('link', { name: 'Phòng thi trực tiếp', exact: true }).first().click();
await page.waitForURL('**/admin/mock-tests?tab=live&exam_id=live-1');
await page.frameLocator('iframe.mts-frame').getByText('Học viên 18', { exact: true }).waitFor();
check('Manage → Live đổi trang ngoài và giữ đúng kỳ thi, không lồng cockpit', await page.locator('iframe').count() === 1 && await page.frameLocator('iframe.mts-frame').locator('.mts-shell, iframe, aver-admin-chrome:not([embed])').count() === 0);
await page.reload();
await page.frameLocator('iframe.mts-frame').getByText('Học viên 18', { exact: true }).waitFor();
check('tải lại Live vẫn chỉ có một lớp workspace', await page.frameLocator('iframe.mts-frame').locator('.mts-shell, iframe, aver-admin-chrome:not([embed])').count() === 0);
await page.getByRole('tab', { name: /Quản lý & giao đề/ }).click();
await page.frameLocator('iframe.mts-frame').getByRole('link', { name: 'Duyệt bài', exact: true }).first().click();
await page.waitForURL('**/admin/mock-tests?tab=review&exam_id=draft-1');
await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.location.pathname === '/admin/mock-reviews');
check('Manage → Review đổi trang ngoài và giữ đề được chọn', await page.frameLocator('iframe.mts-frame').locator('.mts-shell, iframe, aver-admin-chrome:not([embed])').count() === 0);

const openRetake = { id: 'retake-open', code: 'RETAKE-OPEN', title: 'Bài thi lại chờ duyệt', status: 'published', is_open: true, active_section: 'not_started', exam_mode: 'retake', review_eligible: true };
exams.unshift(openRetake);
await page.goto(`${BASE}/admin/mock-tests?tab=review`, { waitUntil: 'domcontentloaded' });
await page.locator('iframe[src="/admin/mock-reviews?mock_exam_id=retake-open&embed=1"]').waitFor();
check('Review chọn retake còn mở có bài chờ duyệt và giữ đề trong rail', await page.getByRole('button', { name: /RETAKE-OPEN.*Có bài cần duyệt/ }).count() === 1);
const archivedQueued = { id: 'archived-queued', code: 'ARCHIVED-QUEUED', title: 'Đề đã lưu trữ còn bài chờ', status: 'archived', is_open: false, active_section: 'writing', exam_mode: 'sequential', review_eligible: true };
exams.unshift(archivedQueued);
await page.goto(`${BASE}/admin/mock-tests?tab=review`, { waitUntil: 'domcontentloaded' });
await page.locator('iframe[src="/admin/mock-reviews?mock_exam_id=archived-queued&embed=1"]').waitFor();
check('Review vẫn chọn đề lưu trữ còn bài chờ sau reload', await page.getByRole('button', { name: /ARCHIVED-QUEUED.*Lưu trữ.*Có bài cần duyệt/ }).count() === 1);
await page.getByRole('button', { name: 'Lưu trữ', exact: true }).click();
check('lọc Lưu trữ giữ đề có bài chờ hiển thị', await page.getByRole('button', { name: /ARCHIVED-QUEUED.*Có bài cần duyệt/ }).count() === 1);
exams.shift();
delete openRetake.review_eligible;
exams.find((exam) => exam.id === 'closed-1').review_eligible = false;
exams.unshift({ id: 'old-sequential', code: 'OLD-SEQUENTIAL', title: 'Đề cũ đã đóng', status: 'published', is_open: false, active_section: 'done', exam_mode: 'sequential' });
await page.goto(`${BASE}/admin/mock-tests?tab=review`, { waitUntil: 'domcontentloaded' });
await page.getByText('Chưa xác định bài thi cần duyệt').waitFor();
check('backend cũ không biến retake hoặc sequential chưa xác định thành trạng thái hết bài', await page.getByText('Trạng thái bài cần duyệt của một số đề chưa xác định').count() === 1 && await page.getByRole('button', { name: /OLD-SEQUENTIAL.*Chưa xác định bài cần duyệt/ }).count() === 1 && await page.getByText('Chưa có bài thi cần duyệt').count() === 0);
exams.shift();
exams.shift();
exams.find((exam) => exam.id === 'closed-1').review_eligible = true;

await page.goto(`${BASE}/admin/mock-tests?tab=live&exam_id=live-1`);
await page.frameLocator('iframe.mts-frame').getByText('Học viên 18', { exact: true }).waitFor();
for (const width of [1440, 1024, 768, 390]) {
  await page.setViewportSize({ width, height: 900 });
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.mts-panel').getBoundingClientRect();
    const rail = document.querySelector('.mts-rail').getBoundingClientRect();
    const tabs = Array.from(document.querySelectorAll('.mts-tabs button')).map((node) => node.getBoundingClientRect());
    const frame = document.querySelector('iframe.mts-frame');
    return { overflow: document.documentElement.scrollWidth > innerWidth, stacked: rail.bottom <= panel.top, tabsFit: tabs.every((tab) => tab.left >= panel.left && tab.right <= panel.right), nested: frame.contentDocument.querySelectorAll('.mts-shell, iframe, aver-admin-chrome:not([embed])').length, childScroll: frame.contentDocument.documentElement.scrollHeight > frame.clientHeight + 2 };
  });
  check(`Live ${width}px không lồng, không tràn và tất cả tab đọc được`, !layout.overflow && layout.tabsFit && !layout.nested && (width > 1200 || layout.stacked), JSON.stringify(layout));
  const frame = page.frameLocator('iframe.mts-frame');
  await frame.getByRole('button', { name: 'Huỷ lượt', exact: true }).last().click();
  await frame.getByRole('dialog').waitFor();
  const dialogVisible = await page.locator('iframe.mts-frame').evaluate((node) => {
    const frame = node.getBoundingClientRect();
    const dialog = node.contentDocument.querySelector('[role="dialog"]').getBoundingClientRect();
    return frame.top + dialog.top >= 0 && frame.top + dialog.bottom <= innerHeight;
  });
  check(`hộp thoại ở học viên cuối ${width}px hiển thị đủ trong viewport`, dialogVisible);
  await frame.getByRole('button', { name: 'Quay lại', exact: true }).click();
  if (process.env.CAPTURE_UI && width === 390) await page.screenshot({ path: '/private/tmp/mock-layout-live-mobile.png', fullPage: true });
}
await page.setViewportSize({ width: 1440, height: 900 });
liveOpen = false;
await page.goto(`${BASE}/admin/mock-tests`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Trung tâm vận hành Mock Test' }).waitFor();
await page.getByRole('tab', { name: /Phòng thi live/ }).click();
await page.getByText('Không có phòng thi đang mở').waitFor();
await page.waitForTimeout(15_500);
check('polling giữ scope Live rỗng thay vì phục hồi đề đầu tiên từ tab Manage', await page.getByText('Không có phòng thi đang mở').count() === 1 && await page.locator('iframe').count() === 0);

await page.setViewportSize({ width: 768, height: 900 });
const tablet = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, columns: getComputedStyle(document.querySelector('.mts-cockpit')).gridTemplateColumns.split(' ').length }));
check('tablet xếp rail và workspace một cột, không tràn ngang', tablet.width <= tablet.viewport && tablet.columns === 1, JSON.stringify(tablet));
await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, tabHeight: parseFloat(getComputedStyle(document.querySelector('.mts-tabs button')).minHeight) }));
check('mobile không tràn ngang và tab đạt 44px', mobile.width <= mobile.viewport && mobile.tabHeight >= 44, `${mobile.width}/${mobile.viewport}, ${mobile.tabHeight}px`);
check('không có lỗi JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Mock Tests native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
