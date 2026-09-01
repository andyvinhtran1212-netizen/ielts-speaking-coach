// Fixture-backed browser contract for the native instructor dashboard.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-instructor-dashboard-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000094';
const instructorId = 'teacher/id';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) {
      return chromium.launch({ executablePath: localChrome });
    }
    throw error;
  }
}

function fakeSession(userId, email) {
  return JSON.stringify({
    access_token: 'instructor-dashboard-not-a-real-token',
    refresh_token: 'x',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, email },
  });
}

async function seedSession(context, userId, email) {
  await context.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, value); } catch (_) {}
  }, [storageKey(SB), fakeSession(userId, email)]);
}

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await seedSession(context, adminId, 'admin-instructor@local');

const requests = [];
const unexpectedWrites = [];
const cohortPosts = [];
const pageErrors = [];
let failCanonicalReadback = false;
const cohorts = [{ id: 'c1', name: 'Khóa Writing 1', created_at: '2026-08-01T00:00:00Z' }];
const fixtures = {
  '/instructor/students': [{ id: 's1', full_name: 'An <script>alert(1)</script>', student_code: 'HV-001', cohort_id: 'c1', user_id: 'u1' }],
  '/instructor/prompts': [{ id: 'p1', title: 'Task 2 <img src=x>', task_type: 'task2' }],
  '/instructor/codes': [{ id: 'code1', code: 'JOIN-001', is_used: false, cohort_id: 'c1' }],
  '/instructor/assignments': [{ id: 'a1', prompt_id: 'p1', student_id: 's1', status: 'delivered', essay_id: 'e1', deadline: null }],
  '/instructor/reviews/queue': [{ essay_id: 'e1', student_email: 'student@example.com', task_type: 'task2', review: { id: 'r1', status: 'queued' } }],
};

const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(String(error)));
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url);
  const method = request.method();
  const path = parsed.pathname;
  requests.push({ method, path, search: parsed.search });
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (path === '/auth/me') return json({ id: adminId, email: 'admin-instructor@local', role: 'admin' });
  if (failCanonicalReadback && method === 'GET' && path.startsWith('/instructor/')) {
    return json({ detail: 'fixture canonical read failed' }, 503);
  }
  if (method === 'GET' && path === '/instructor/cohorts') return json(cohorts);
  if (method === 'GET' && Object.hasOwn(fixtures, path)) return json(fixtures[path]);
  if (method === 'GET' && path === '/instructor/students/s1/summary') {
    return json({
      student: { id: 's1', full_name: 'An <script>alert(1)</script>', student_code: 'HV-001', target_band: 7.0 },
      stats: { total_essays: 3, graded_count: 2, flagged_count: 1, average_band_last5: 6.5 },
      recent_essays: [{ id: 'e1', task_type: 'task2', status: 'delivered' }],
    });
  }
  if (method === 'POST' && path === '/instructor/cohorts') {
    const body = request.postDataJSON();
    cohortPosts.push(body);
    if (body.name === 'Lớp lỗi') {
      failCanonicalReadback = true;
      return json({ detail: 'fixture mutation failed' }, 500);
    }
    cohorts.push({ id: 'c2', name: body.name, created_at: '2026-08-16T00:00:00Z' });
    return json(cohorts.at(-1), 201);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)
      && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${path}`)) {
    unexpectedWrites.push(`${method} ${path}`);
  }
  return json({});
});

await page.goto(`${BASE}/instructor?as_instructor=teacher%2Fid`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Học viên của tôi' }).waitFor({ state: 'visible' });

const ownerReads = requests.filter((item) => item.method === 'GET' && item.path.startsWith('/instructor/'));
check('đọc đủ 6 collection owner-scoped', new Set(ownerReads.map((item) => item.path)).size === 6, ownerReads.map((item) => item.path).join(', '));
check('mọi request instructor mang đúng as_instructor', ownerReads.every((item) => new URLSearchParams(item.search).get('as_instructor') === instructorId));
check('hiển thị roster và banner impersonation', await page.getByText('An <script>alert(1)</script>', { exact: true }).count() === 1 && await page.getByText(/Đang xem như giảng viên/).count() === 1);
check('nội dung độc hại được React escape', await page.locator('.ins-main script, .ins-main img, .ins-main iframe').count() === 0);

await page.getByRole('button', { name: 'An <script>alert(1)</script>' }).click();
await page.getByRole('complementary', { name: 'Hồ sơ học viên' }).getByText('Band TB 5 bài', { exact: true }).waitFor({ state: 'visible' });
check('drawer dùng summary canonical có impersonation', requests.some((item) => item.path === '/instructor/students/s1/summary' && new URLSearchParams(item.search).get('as_instructor') === instructorId));
check('drawer hiển thị đúng thống kê', await page.getByRole('complementary', { name: 'Hồ sơ học viên' }).getByText('6.5', { exact: true }).count() === 1);
check('drawer giữ target_band dạng số từ backend', await page.getByRole('complementary', { name: 'Hồ sơ học viên' }).getByText('HV-001 · Mục tiêu 7', { exact: true }).count() === 1);
await page.getByRole('button', { name: 'Đóng', exact: true }).click();

await page.getByRole('button', { name: 'Lớp & Mã' }).click();
await page.getByLabel('Tên lớp mới').fill('Lớp xác minh canonical');
const readsBeforeMutation = requests.filter((item) => item.method === 'GET' && item.path === '/instructor/cohorts').length;
await page.getByRole('button', { name: 'Tạo lớp', exact: true }).click();
await page.getByText('Đã tạo lớp.', { exact: true }).waitFor({ state: 'visible' });
await page.getByRole('cell', { name: 'Lớp xác minh canonical', exact: true }).waitFor({ state: 'visible' });
const readsAfterMutation = requests.filter((item) => item.method === 'GET' && item.path === '/instructor/cohorts').length;
check('mutation gửi body tối thiểu đúng contract', cohortPosts.length === 1 && JSON.stringify(cohortPosts[0]) === JSON.stringify({ name: 'Lớp xác minh canonical' }));
check('sau mutation reload canonical và không replay POST', readsAfterMutation === readsBeforeMutation + 1 && cohortPosts.length === 1);
check('mã ghi danh render cùng lớp canonical', await page.getByText('JOIN-001', { exact: true }).count() === 1 && await page.getByText('Khóa Writing 1', { exact: true }).count() >= 2);

await page.getByLabel('Tên lớp mới').fill('Lớp lỗi');
await page.getByRole('button', { name: 'Tạo lớp', exact: true }).click();
await page.getByText(/Chưa xác nhận được trạng thái canonical; hệ thống không tự gửi lại mutation/).waitFor({ state: 'visible' });
check('mutation lỗi không replay và không tuyên bố reload canonical giả', cohortPosts.length === 2
  && await page.getByText(/Không thể làm mới; đang giữ snapshot trước đó/).count() === 1);

await page.getByRole('button', { name: 'Giao bài' }).click();
check('ma trận assignment render trạng thái canonical', await page.getByText('Đã trả', { exact: true }).count() === 1 && await page.getByText('Task 2 <img src=x>', { exact: true }).count() >= 1);
await page.getByRole('button', { name: 'Chấm bài' }).click();
check('hàng chờ chấm render đúng review canonical', await page.getByText('student@example.com', { exact: true }).count() === 1 && await page.getByRole('button', { name: 'Nhận chấm' }).count() === 1);
check('mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check('không có write ngoài mutation fixture', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

const deniedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
await seedSession(deniedContext, 'student-1', 'student@local');
const deniedPage = await deniedContext.newPage();
const deniedInstructorReads = [];
await deniedPage.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url);
  if (parsed.pathname.startsWith('/instructor/')) deniedInstructorReads.push(`${request.method()} ${parsed.pathname}`);
  const body = parsed.pathname === '/auth/me'
    ? { id: 'student-1', email: 'student@local', role: 'student' }
    : {};
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await deniedPage.goto(`${BASE}/instructor?as_instructor=${instructorId}`, { waitUntil: 'domcontentloaded' });
await deniedPage.getByRole('alert').getByText('Bạn không có quyền truy cập trang giảng viên.', { exact: true }).waitFor({ state: 'visible' });
check('student bị chặn trước mọi instructor read', deniedInstructorReads.length === 0, deniedInstructorReads.join(', '));

await deniedContext.close();
await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nInstructor dashboard native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
