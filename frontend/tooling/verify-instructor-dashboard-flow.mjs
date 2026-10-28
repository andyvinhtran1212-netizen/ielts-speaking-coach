// Fixture-backed browser contract for the native instructor dashboard.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-instructor-dashboard-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const FIXTURE_API_PREFIX = '/__fixture_api';
const fixtureRuntime = `window.__AVER_RUNTIME_CONFIG__=Object.freeze({environment:'local-test',apiBase:${JSON.stringify(`${BASE}${FIXTURE_API_PREFIX}`)},supabaseUrl:null,supabaseAnonKey:null,release:null,gitRef:null,coreOperationCorrelationEnabled:false,writingAdmissionEnabled:false});`;
const SB = process.env.SUPABASE_URL || 'https://zjphffoujxkpltixsbzj.supabase.co';
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
    window.__AVER_SUPABASE_CLIENT__ = { auth: {
      getSession: async () => ({ data: { session: JSON.parse(value) }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    } };
  }, [storageKey(SB), fakeSession(userId, email)]);
}

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York' });
await seedSession(context, adminId, 'admin-instructor@local');

const requests = [];
const unexpectedWrites = [];
const cohortPosts = [];
const assignmentPosts = [];
const previewPosts = [];
// Like the backend: a give's overlap is every class member who already holds
// one of the prompts, from any earlier give (individual, other class, admin).
const holders = (promptIds) => [...new Set(fixtures['/instructor/assignments']
  .filter((row) => promptIds.includes(row.prompt_id)).map((row) => row.student_id))].filter((id) => id === 's1');
const pageErrors = [];
const dialogs = [];
const dialogAnswers = [];
let failCanonicalReadback = false;
const cohorts = [{ id: 'c1', name: 'Khóa Writing 1', created_at: '2026-08-01T00:00:00Z' }];
const fixtures = {
  '/instructor/students': [{ id: 's1', full_name: 'An <script>alert(1)</script>', student_code: 'HV-001', cohort_id: 'c1', user_id: 'u1' }],
  '/instructor/prompts': [{ id: 'p1', title: 'Task 2 <img src=x>', task_type: 'task2' }, { id: 'p2', title: 'Task 1 mới', task_type: 'task1_academic' }],
  '/instructor/codes': [{ id: 'code1', code: 'JOIN-001', is_used: false, cohort_id: 'c1' }],
  // Newest first, like the backend (created_at desc). A-07: s1 × p1 was given
  // twice; the older give is overdue, the newer one is delivered.
  '/instructor/assignments': [
    { id: 'a1', prompt_id: 'p1', student_id: 's1', status: 'delivered', essay_id: 'e1', deadline: null, created_at: '2026-10-20T00:00:00Z' },
    { id: 'a0', prompt_id: 'p1', student_id: 's1', status: 'pending', essay_id: null, deadline: '2026-09-08T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
  ],
  '/instructor/reviews/queue': [{ essay_id: 'e1', student_email: 'student@example.com', task_type: 'task2', review: { id: 'r1', status: 'queued' } }],
};

const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('dialog', async (dialog) => {
  dialogs.push(dialog.message());
  if (dialogAnswers.shift()) await dialog.accept();
  else await dialog.dismiss();
});
await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  const routedPath = new URL(url).pathname;
  if (url.startsWith(BASE) && routedPath === '/js/runtime-config.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: fixtureRuntime });
  if ((url.startsWith(BASE) && !routedPath.startsWith(FIXTURE_API_PREFIX)) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url);
  const method = request.method();
  const path = parsed.pathname.startsWith(FIXTURE_API_PREFIX) ? parsed.pathname.slice(FIXTURE_API_PREFIX.length) : parsed.pathname;
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
  if (method === 'POST' && path === '/instructor/assignments/duplicates-preview') {
    const body = request.postDataJSON();
    previewPosts.push(body);
    return json({ student_count: 1, duplicate_student_ids: holders(body.prompt_ids) });
  }
  if (method === 'POST' && ['/instructor/assignments', '/instructor/assignments/fan-out'].includes(path)) {
    const body = request.postDataJSON();
    assignmentPosts.push({ path, body });
    if (path === '/instructor/assignments') return json({ id: 'a-new', prompt_id: body.prompt_id, student_id: body.student_id, name: body.name ?? null }, 201);
    // Fan-out: the canonical list (newest first, like the backend) gains the
    // give; a re-give reports the overlap as duplicates_warning (ALLOW + WARN).
    const rows = fixtures['/instructor/assignments'];
    const duplicates = holders(body.prompt_ids);
    const groupId = `g${assignmentPosts.length}`;
    rows.unshift({ id: `a-${groupId}`, prompt_id: body.prompt_ids[0], student_id: 's1', status: 'pending', essay_id: null, deadline: body.deadline ?? null, cohort_id: body.cohort_id, assignment_group_id: groupId, name: body.name ?? null, created_at: '2026-10-25T12:30:00Z' });
    return json({ student_count: 1, created_count: 1, group_id: groupId, duplicates_warning: duplicates, assignment_ids: [`a-${groupId}`] }, 201);
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

await page.getByRole('button', { name: 'Giao bài', exact: true }).click();
const matrixCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Ma trận nộp bài' }) });
check('A-07: ma trận hiện lượt giao mới nhất, một cột cho mỗi đề', await matrixCard.locator('thead th').count() === 2
  && (await matrixCard.locator('tbody td').nth(1).innerText()).trim() === 'Đã trả'
  && await matrixCard.getByText('Trễ', { exact: true }).count() === 0);
const assignmentForm = page.locator('form').filter({ has: page.locator('input[name="deadline"]') });
const fillCohortGive = async (name) => {
  await assignmentForm.locator('select[name="prompt_id"]').selectOption('p1');
  await assignmentForm.getByLabel('Tên bài (học viên sẽ thấy)').fill(name);
  await assignmentForm.locator('select[name="cohort_id"]').selectOption('c1');
  await assignmentForm.getByLabel('Hạn nộp (giờ Việt Nam)').fill('2026-10-27T23:00');
};
// BL-19: with nothing chosen the app's own message shows (the form is
// noValidate), focus moves to the missing field and nothing is sent.
await assignmentForm.getByRole('button', { name: 'Giao bài', exact: true }).click();
await page.locator('.ins-banner.is-danger', { hasText: 'Chưa chọn đề bài.' }).waitFor();
check('BL-19: bấm Giao bài khi chưa chọn đề hiện thông báo của app, focus vào ô đề', await assignmentForm.locator('select[name="prompt_id"]').evaluate((element) => element === document.activeElement)
  && dialogs.length === 0 && assignmentPosts.length === 0 && previewPosts.length === 0);

// BL-18: s1 already holds p1 from individual gives (no class stamp), so the
// first class give asks before writing — the old flow only warned afterwards.
await fillCohortGive('Buổi 5 — Task 2');
dialogAnswers.push(false);
await assignmentForm.getByRole('button', { name: 'Giao bài', exact: true }).click();
for (let tries = 0; tries < 100 && dialogs.length < 1; tries += 1) await page.waitForTimeout(50);
await page.waitForFunction(() => !document.querySelector('form.ins-form button[type="submit"]')?.disabled);
check('BL-18: giao cho lớp có học viên đã nhận đề → hỏi trước khi gửi; hủy thì không gửi', dialogs.length === 1
  && dialogs[0] === "1 học viên trong lớp đã được giao đề 'Task 2 <img src=x>' từ trước. Giao thêm một lượt nữa?"
  && previewPosts.length === 1 && previewPosts[0].cohort_id === 'c1' && JSON.stringify(previewPosts[0].prompt_ids) === '["p1"]'
  && new URLSearchParams(requests.filter((item) => item.path === '/instructor/assignments/duplicates-preview').at(-1)?.search).get('as_instructor') === instructorId
  && assignmentPosts.length === 0
  && await assignmentForm.locator('input[name="name"]').inputValue() === 'Buổi 5 — Task 2', dialogs[0]);
dialogAnswers.push(true);
await assignmentForm.getByRole('button', { name: 'Giao bài', exact: true }).click();
await page.getByText('Đã giao bài cho lớp. Lưu ý: 1 học viên đã được giao đề này từ trước.', { exact: true }).waitFor();
check('BL-18: đồng ý thì gửi đúng một request kèm name, banner sau vẫn khớp số đã hỏi', dialogs.length === 2 && assignmentPosts.length === 1 && assignmentPosts[0].body.name === 'Buổi 5 — Task 2');
check('form giao bài reset sau khi thành công', await assignmentForm.locator('select[name="prompt_id"]').inputValue() === ''
  && await assignmentForm.locator('input[name="name"]').inputValue() === ''
  && await assignmentForm.locator('select[name="cohort_id"]').inputValue() === ''
  && await assignmentForm.locator('input[name="deadline"]').inputValue() === '');

await fillCohortGive('Buổi 6 — Task 2');
// The class itself was given p1 above: the W-06 confirm covers it, so no preview read.
const previewsBeforeRegive = previewPosts.length;
dialogAnswers.push(false);
await assignmentForm.getByRole('button', { name: 'Giao bài', exact: true }).click();
await page.waitForTimeout(200);
check('giao lại cùng đề cho lớp hỏi xác nhận; hủy thì không gửi request', dialogs.length === 3
  && /^Lớp này đã được giao đề 'Task 2 <img src=x>' lúc .+\. Giao thêm một lượt nữa\?$/.test(dialogs[2])
  && assignmentPosts.length === 1
  && await assignmentForm.locator('input[name="name"]').inputValue() === 'Buổi 6 — Task 2', dialogs[2]);
dialogAnswers.push(true);
await assignmentForm.getByRole('button', { name: 'Giao bài', exact: true }).click();
// The first give left the same warning banner up; wait for this give's POST + readback.
for (let tries = 0; tries < 100 && assignmentPosts.length < 2; tries += 1) await page.waitForTimeout(50);
await page.getByText('Đã giao bài cho lớp. Lưu ý: 1 học viên đã được giao đề này từ trước.', { exact: true }).waitFor();
check('đồng ý thì gửi đúng một request và banner cảnh báo duplicates_warning; không hỏi lần hai', dialogs.length === 4 && assignmentPosts.length === 2 && previewPosts.length === previewsBeforeRegive
  && assignmentPosts[1].body.name === 'Buổi 6 — Task 2'
  && await page.locator('.ins-banner.is-warning', { hasText: '1 học viên đã được giao đề này từ trước' }).count() === 1);

await assignmentForm.locator('input[value="student"]').check();
await assignmentForm.locator('select[name="prompt_id"]').selectOption('p1');
await assignmentForm.locator('select[name="student_id"]').selectOption('s1');
await assignmentForm.getByLabel('Hạn nộp (giờ Việt Nam)').fill('2026-10-27T23:00');
dialogAnswers.push(true);
await assignmentForm.getByRole('button', { name: 'Giao bài', exact: true }).click();
await page.getByText('Đã giao bài cho học viên.', { exact: true }).waitFor();
check('giao lẻ cho học viên đã có đề cũng hỏi xác nhận', dialogs.length === 5 && /^Học viên này đã được giao đề /.test(dialogs[4]));
check('both assignment targets send Vietnam offset from a New York browser', assignmentPosts.length === 3 && assignmentPosts.every(({ body }) => body.deadline === '2026-10-27T23:00:00+07:00'));
check('giao lẻ không gửi name khi bỏ trống', !Object.hasOwn(assignmentPosts[2].body, 'name'));

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
// A-07: the fan-out gives above are now the newest s1 × p1 rows, so the cell
// follows the latest give (pending, due 2026-10-27 23:00 ICT), not the delivered one.
const newestGiveLabel = Date.now() > Date.parse('2026-10-27T23:00:00+07:00') ? 'Trễ' : 'Chưa nộp';
check('ma trận assignment render trạng thái canonical của lượt giao mới nhất', await matrixCard.locator('thead th').count() === 2
  && (await matrixCard.locator('tbody td').nth(1).locator('.ins-pill').innerText()).trim() === newestGiveLabel
  && await matrixCard.getByText('Đã trả', { exact: true }).count() === 0
  && await page.getByText('Task 2 <img src=x>', { exact: true }).count() >= 1, newestGiveLabel);
// W-12: the cell carries its give's deadline (23:00 ICT entered from a New York browser).
check('W-12: ma trận hiện hạn nộp của lượt giao trong ô', (await matrixCard.locator('tbody td').nth(1).locator('.ins-cell-deadline').innerText()).trim() === 'Hạn 23:00 27/10/26');

// BL-18: nobody holds p2 yet → the preview is read, nothing is asked.
failCanonicalReadback = false; // the backend recovered from the "Lớp lỗi" case above
const dialogsBeforeFreshGive = dialogs.length; const previewsBeforeFreshGive = previewPosts.length;
await assignmentForm.locator('input[value="cohort"]').check();
await assignmentForm.locator('select[name="prompt_id"]').selectOption('p2');
await assignmentForm.locator('select[name="cohort_id"]').selectOption('c1');
await assignmentForm.getByRole('button', { name: 'Giao bài', exact: true }).click();
await page.getByText('Đã giao bài cho lớp.', { exact: true }).waitFor();
check('BL-18: đề chưa ai nhận thì không hỏi xác nhận', dialogs.length === dialogsBeforeFreshGive && previewPosts.length === previewsBeforeFreshGive + 1
  && JSON.stringify(previewPosts.at(-1)?.prompt_ids) === '["p2"]' && assignmentPosts.at(-1)?.body.prompt_ids?.[0] === 'p2', `${dialogs.length - dialogsBeforeFreshGive} dialogs, ${previewPosts.length - previewsBeforeFreshGive} previews`);

await page.getByRole('button', { name: 'Chấm bài' }).click();
check('hàng chờ chấm render đúng review canonical', await page.getByText('student@example.com', { exact: true }).count() === 1 && await page.getByRole('button', { name: 'Nhận chấm' }).count() === 1);
check('mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check('không có write ngoài mutation fixture', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

const deniedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York' });
await seedSession(deniedContext, 'student-1', 'student@local');
const deniedPage = await deniedContext.newPage();
const deniedInstructorReads = [];
await deniedPage.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  const routedPath = new URL(url).pathname;
  if (url.startsWith(BASE) && routedPath === '/js/runtime-config.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: fixtureRuntime });
  if ((url.startsWith(BASE) && !routedPath.startsWith(FIXTURE_API_PREFIX)) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url);
  const path = parsed.pathname.startsWith(FIXTURE_API_PREFIX) ? parsed.pathname.slice(FIXTURE_API_PREFIX.length) : parsed.pathname;
  if (path.startsWith('/instructor/')) deniedInstructorReads.push(`${request.method()} ${path}`);
  const body = path === '/auth/me'
    ? { id: 'student-1', email: 'student@local', role: 'student' }
    : {};
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await deniedPage.goto(`${BASE}/instructor?as_instructor=${instructorId}`, { waitUntil: 'domcontentloaded' });
await deniedPage.getByRole('alert').getByText('Bạn không có quyền truy cập trang giảng viên.', { exact: true }).waitFor({ state: 'visible' });
check('student bị chặn trước mọi instructor read', deniedInstructorReads.length === 0, deniedInstructorReads.join(', '));

await deniedContext.close();

// W-12: a token refresh that never answers keeps the auth provider loading;
// the dashboard must fail closed to /login instead of waiting forever. The
// main page is closed first: a second open page can be timer-throttled to
// ~1 wake-up/minute by Chromium, which delays the bound past the wait below.
await context.close();
const stuckContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await stuckContext.addInitScript(() => {
  window.__AVER_SUPABASE_CLIENT__ = { auth: {
    getSession: () => new Promise(() => {}),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
  } };
});
const stuckPage = await stuckContext.newPage();
await stuckPage.route('**/*', async (route) => {
  const url = route.request().url();
  const routedPath = new URL(url).pathname;
  if (url.startsWith(BASE) && routedPath === '/js/runtime-config.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: fixtureRuntime });
  if ((url.startsWith(BASE) && !routedPath.startsWith(FIXTURE_API_PREFIX)) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});
await stuckPage.goto(`${BASE}/instructor`, { waitUntil: 'domcontentloaded' });
await stuckPage.getByText('Đang kiểm tra quyền và tải workspace…', { exact: true }).waitFor();
const stuckVisibility = await stuckPage.evaluate(() => document.visibilityState);
const stuckStarted = Date.now();
const reachedLogin = await stuckPage.waitForURL(/\/login(?:[?#]|$)/, { timeout: 45_000 }).then(() => true, () => false);
const waitedMs = Date.now() - stuckStarted;
check('W-12: phiên không xác nhận được → về /login thay vì treo ở màn tải', reachedLogin && waitedMs >= 10_000, `${waitedMs} ms → ${stuckPage.url()} (${stuckVisibility})`);
await stuckContext.close();
await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nInstructor dashboard native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
