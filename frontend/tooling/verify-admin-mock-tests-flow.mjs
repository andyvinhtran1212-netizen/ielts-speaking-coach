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
const exams = [
  { id: 'draft-1', code: 'MOCK-DRAFT', title: 'Đề đang soạn', status: 'draft', is_open: false, active_section: 'not_started', exam_mode: 'sequential' },
  { id: 'live-1', code: 'MOCK-LIVE', title: 'Đề đang thi', status: 'published', is_open: true, active_section: 'reading', exam_mode: 'sequential' },
  { id: 'closed-1', code: 'MOCK-CLOSED', title: 'Đề đã đóng', status: 'published', is_open: false, active_section: 'done', exam_mode: 'retake' },
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-mock-tests@local', role: 'admin' });
  if (parsed.pathname === '/admin/mock-exams') return json({ exams });
  if (parsed.pathname === '/admin/mock-exams/live-1/live') return json({
    exam: { id: 'live-1', code: 'MOCK-LIVE', title: 'Đề đang thi', exam_mode: 'sequential', status: 'published', is_open: true, active_section: 'reading', collected_section: null, section_started_at: null, section_duration_seconds: 3600, section_time_left_seconds: 1200, configured_sections: ['listening', 'reading', 'writing'], cohort_id: null },
    roster: { expected: null, started: 0, not_started: [], off_roster: [] },
    sections: { listening: { submitted: 0, working: 0, absent: 0, missed: 0, expected: 0 }, reading: { submitted: 0, working: 0, absent: 0, missed: 0, expected: 0 }, writing: { submitted: 0, working: 0, absent: 0, missed: 0, expected: 0 } },
    students: [], server_time: '2026-08-16T08:00:00Z',
  });
  return json({ detail: 'unhandled fixture route' }, 500);
});

await page.goto(`${BASE}/admin/mock-tests?tab=live`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Mock Test cockpit' }).waitFor();
await page.getByText('2 đề sai contract đã bị loại').waitFor();
check('backend-owned admin gate và canonical exam list chạy', requests.includes('GET /auth/me') && requests.includes('GET /admin/mock-exams'));
check('deep-link live fail-closed khi đề mặc định còn draft', await page.getByText('Đề chưa được publish').count() === 1 && await page.locator('iframe').count() === 0);

await page.getByRole('button', { name: /MOCK-LIVE/ }).click();
await page.locator('iframe').waitFor();
check('live frame giữ đúng selected exam identity và dùng route native', (await page.locator('iframe').getAttribute('src')) === '/admin/mock-live?exam_id=live-1&embed=1');
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.documentElement.getAttribute('data-theme') === 'dark');
check('theme parent được đồng bộ sang workspace native', await page.locator('iframe').evaluate((node) => node.contentDocument?.documentElement.getAttribute('data-theme') === 'dark'));

await page.getByRole('button', { name: 'Đang thi', exact: true }).click();
check('stage filter giữ canonical total và đúng một live exam', await page.getByText('1/3', { exact: true }).count() === 1 && await page.getByRole('button', { name: /MOCK-LIVE/ }).count() === 1 && await page.getByRole('button', { name: /MOCK-DRAFT/ }).count() === 0);
await page.getByRole('button', { name: 'Đã đóng', exact: true }).click();
check('lọc không tự đổi đề đang thao tác', await page.getByText('Đề đang thao tác bị ẩn bởi bộ lọc').count() === 1 && (await page.locator('iframe').getAttribute('src'))?.includes('exam_id=live-1'));

await page.getByRole('tab', { name: /Duyệt bài thi/ }).click();
check('tab query shareable và review frame giữ exact identity', new URL(page.url()).searchParams.get('tab') === 'review' && (await page.locator('iframe').getAttribute('src')) === '/pages/admin/mock-reviews/index.html?mock_exam_id=live-1&embed=1');

await page.getByRole('tab', { name: 'Chấm Writing' }).click();
check('Writing dùng native queue thay vì legacy file', (await page.locator('iframe').getAttribute('src')) === '/admin/writing/queue?embed=1&mocklane=1');
await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.location.pathname === '/admin/writing/queue');
await page.locator('iframe').evaluate((node) => node.contentWindow.history.pushState({}, '', '/admin/writing/grade?essay_id=fixture-child'));
check('fixture đã đi sâu khỏi Writing queue', await page.locator('iframe').evaluate((node) => node.contentWindow.location.pathname === '/admin/writing/grade'));
await page.getByRole('tab', { name: 'Chấm Writing' }).click();
await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.location.pathname === '/admin/writing/queue');
check('bấm lại tab hiện tại trả iframe về workspace gốc', await page.locator('iframe').evaluate((node) => node.contentWindow.location.pathname === '/admin/writing/queue'));

await page.getByRole('tab', { name: 'Chấm Writing' }).press('Home');
check('tablist hỗ trợ Home/End/arrow mà không tự kích hoạt iframe', await page.getByRole('tab', { name: 'Quản lý đề' }).evaluate((node) => node === document.activeElement) && new URL(page.url()).searchParams.get('tab') === 'writing');

await page.getByRole('tab', { name: 'Quản lý đề' }).click();
await page.locator('iframe[src="/admin/mock-exams?embed=1"]').waitFor();
check('Manage đã nhúng route Next.js native, không còn rollback HTML', (await page.locator('iframe').getAttribute('src')) === '/admin/mock-exams?embed=1' && await page.getByText('MODULE ROLLBACK').count() === 0);

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, tabHeight: parseFloat(getComputedStyle(document.querySelector('.mts-tabs button')).minHeight) }));
check('mobile không tràn ngang và tab đạt 44px', mobile.width <= mobile.viewport && mobile.tabHeight >= 44, `${mobile.width}/${mobile.viewport}, ${mobile.tabHeight}px`);
check('không có lỗi JavaScript', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Mock Tests native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
