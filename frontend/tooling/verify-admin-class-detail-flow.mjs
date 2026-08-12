// Fixture-backed browser contract for native `/admin/classes/[cohortId]`.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-admin-class-detail-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000098';
const cohortId = 'cohort-fixture';
const fakeSession = JSON.stringify({
  access_token: 'admin-class-detail-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: adminId, email: 'admin-class-detail@local' },
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launchChromium() {
  try { return await chromium.launch(); }
  catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome });
    throw error;
  }
}

const cohort = { id: cohortId, name: 'TUE–FRI (18H)', code_prefix: 'AUG4', description: 'Khoá nền tảng tiếng Anh', course_id: 'course-1', is_active: true };
let members = [
  { student_id: 'st-a', student_code: 'A001', name: 'Andy <img src=x onerror=alert(1)>', user_id: 'u-a', sessions: 12, last_active: '2026-08-11T12:00:00Z', ai_cost_usd: 1.25 },
  { student_id: 'st-b', student_code: 'B001', name: 'Bình', user_id: null, sessions: null, last_active: null, ai_cost_usd: null },
];
const students = [
  { id: 'st-a', student_code: 'A001', full_name: 'Andy', cohort_id: cohortId, cohort_name: cohort.name },
  { id: 'st-b', student_code: 'B001', full_name: 'Bình', cohort_id: cohortId, cohort_name: cohort.name },
  { id: 'st-c', student_code: 'C001', full_name: 'Chi', cohort_id: 'old-class', cohort_name: 'Lớp cũ' },
];
let lessons = [{ id: 'lesson-1', title: 'Grammar 1 <script>alert(1)</script>', lesson_no: 1, lesson_date: '2026-08-10', body_md: 'Articles and nouns', attachments: [{ label: 'Tài liệu', url: 'https://example.com/doc' }, { label: 'Unsafe', url: 'javascript:alert(1)' }], is_published: true }];
let failCourses = true;
let failNextRoster = false;
let failNextLessons = false;
let failProgress = false;

const requests = [];
const unexpectedWrites = [];
const allowedWrites = [
  /^PATCH \/admin\/cohorts\/[^/]+$/,
  /^POST \/admin\/cohorts\/[^/]+\/students$/,
  /^DELETE \/admin\/cohorts\/[^/]+\/students\/[^/]+$/,
  /^POST \/admin\/cohorts\/[^/]+\/lessons$/,
  /^PATCH \/admin\/cohorts\/[^/]+\/lessons\/[^/]+$/,
  /^DELETE \/admin\/cohorts\/[^/]+\/lessons\/[^/]+$/,
  /^POST \/api\/(analytics\/events|error-logs)$/,
];

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (_) {} }, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url);
  const method = request.method();
  requests.push({ method, path: parsed.pathname, body: request.postData() });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const signature = `${method} ${parsed.pathname}`;
    if (!allowedWrites.some((pattern) => pattern.test(signature))) unexpectedWrites.push(signature);
  }
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (parsed.pathname === '/auth/me') return json({ id: adminId, email: 'admin-class-detail@local', role: 'admin' });
  if (parsed.pathname === '/admin/courses') return failCourses ? json({ detail: 'fixture courses failed' }, 503) : json({ courses: [{ id: 'course-1', code: 'C1', name: 'Khoá 1', is_active: true }] });
  if (parsed.pathname === `/admin/cohorts/${cohortId}/members`) {
    if (failNextRoster) { failNextRoster = false; return json({ detail: 'fixture roster reload failed' }, 503); }
    return json({ cohort, member_count: members.length, members });
  }
  if (parsed.pathname === '/admin/students' && method === 'GET') return json(students);
  if (parsed.pathname === `/admin/cohorts/${cohortId}` && method === 'PATCH') {
    Object.assign(cohort, JSON.parse(request.postData() || '{}'));
    return json(cohort);
  }
  if (parsed.pathname === `/admin/cohorts/${cohortId}/students` && method === 'POST') {
    const body = JSON.parse(request.postData() || '{}');
    if (body.student_id === 'st-c') members.push({ student_id: 'st-c', student_code: 'C001', name: 'Chi', user_id: 'u-c', sessions: 0, last_active: null, ai_cost_usd: 0 });
    return json({ ok: true, student_id: body.student_id, cohort_id: cohortId });
  }
  const memberMatch = parsed.pathname.match(new RegExp(`^/admin/cohorts/${cohortId}/students/([^/]+)$`));
  if (memberMatch && method === 'DELETE') {
    members = members.filter((member) => member.student_id !== memberMatch[1]);
    return route.fulfill({ status: 204, body: '' });
  }
  if (parsed.pathname === `/admin/cohorts/${cohortId}/progress`) {
    if (failProgress) return json({ detail: 'fixture progress failed' }, 503);
    return json({
    students: members.map((member, index) => ({
      student_id: member.student_id, student_code: member.student_code, name: member.name,
      activated: Boolean(member.user_id), target_band: 7,
      skills: {
        speaking: index === 0 ? null : { attempts: 0, last_activity: null, last_band: null, recent_bands: [] },
        writing: { attempts: index === 0 ? 2 : 0, last_activity: index === 0 ? '2026-08-11T00:00:00Z' : null, last_band: index === 0 ? 6.5 : null, recent_bands: index === 0 ? [6, 6.5] : [] },
        reading: { attempts: 1, last_activity: '2026-08-12T00:00:00Z', last_band: 7, recent_bands: [7] },
        listening: { attempts: 0, last_activity: null, last_band: null, recent_bands: [] },
      },
      homework: index === 0 ? null : { assigned: 1, submitted: 0, late: 0, missing: 1, on_time_pct: null },
    })),
    degraded: ['speaking', 'homework', 'homework_stale'],
    });
  }
  if (parsed.pathname === `/admin/cohorts/${cohortId}/lessons` && method === 'GET') {
    if (failNextLessons) { failNextLessons = false; return json({ detail: 'fixture lesson reload failed' }, 503); }
    return json({ lessons });
  }
  if (parsed.pathname === `/admin/cohorts/${cohortId}/lessons` && method === 'POST') {
    const row = { id: 'lesson-new', ...JSON.parse(request.postData() || '{}') };
    lessons.push(row); return json(row, 201);
  }
  const lessonMatch = parsed.pathname.match(new RegExp(`^/admin/cohorts/${cohortId}/lessons/([^/]+)$`));
  if (lessonMatch && method === 'PATCH') {
    const row = lessons.find((lesson) => lesson.id === lessonMatch[1]);
    if (!row) return json({ detail: 'fixture lesson missing' }, 404);
    Object.assign(row, JSON.parse(request.postData() || '{}'));
    return json(row);
  }
  if (lessonMatch && method === 'DELETE') {
    lessons = lessons.filter((lesson) => lesson.id !== lessonMatch[1]);
    return route.fulfill({ status: 204, body: '' });
  }
  return json({});
});

const hasCanonicalReadAfter = (method, pattern, readPath) => {
  const index = requests.findIndex((item) => item.method === method && pattern.test(item.path));
  return index >= 0 && requests.slice(index + 1).some((item) => item.method === 'GET' && item.path === readPath);
};
const progressReadCount = () => requests.filter((item) => item.method === 'GET' && item.path === `/admin/cohorts/${cohortId}/progress`).length;

await page.goto(`${BASE}/admin/classes/${cohortId}`, { waitUntil: 'domcontentloaded' });
try { await page.getByRole('heading', { name: cohort.name, exact: true }).waitFor({ state: 'visible' }); }
catch (error) {
  console.error('  URL:', page.url());
  console.error('  Body:', (await page.locator('body').innerText().catch(() => '')).slice(0, 1800));
  console.error('  JS:', pageErrors.join(' | '));
  throw error;
}

check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('roster và course là hai nguồn độc lập', requests.some((item) => item.path.endsWith('/members')) && requests.some((item) => item.path === '/admin/courses'));
check('course failure không làm roster biến mất', await page.getByText('Bình', { exact: true }).count() === 1 && await page.getByText(/Không đọc được danh mục khoá/).count() === 1);
check('usage null không bị bịa thành 0', await page.locator('tr').filter({ hasText: 'Bình' }).getByText('Không đọc được', { exact: true }).count() >= 2);
check('payload độc hại được React escape', await page.locator('.acx-shell img, .acx-shell script').count() === 0);
check('marking mở bằng workspace native', await page.getByRole('button', { name: /Nhận bài & Chấm bài/ }).count() === 1 && await page.locator('a[href*="/pages/admin/classes/index.html"]').count() === 0);
check('workspace marking không giả làm tab cấp lớp', await page.getByRole('tab', { name: /Nhận bài & Chấm bài/ }).count() === 0);

await page.getByRole('tab', { name: /Tiến độ 4 kỹ năng/ }).click();
await page.getByRole('heading', { name: 'Tiến độ 4 kỹ năng' }).waitFor({ state: 'visible' });
await page.getByText(/Không đọc được: speaking, homework/).waitFor({ state: 'visible' });
const initialProgressReads = progressReadCount();
check('tab đồng bộ URL và panel được gắn nhãn', new URL(page.url()).searchParams.get('tab') === 'progress' && await page.locator('#acx-panel-progress[aria-labelledby="acx-tab-progress"]').count() === 1);
check('degraded skill/homework hiện unknown, không hiện fake zero', await page.locator('tr').filter({ hasText: /Andy/ }).getByText('Không đọc được', { exact: true }).count() >= 2);
check('band dưới mục tiêu có nhãn chữ, không chỉ dùng màu', await page.getByText('2 dưới mục tiêu 7', { exact: true }).count() === 1);
await page.getByRole('tab', { name: /Sổ điểm danh/ }).click();

failCourses = false;
await page.getByRole('button', { name: 'Sửa thông tin lớp' }).click();
const classDialog = page.getByRole('dialog');
await classDialog.getByLabel('Tiền tố mã').fill('');
await classDialog.getByLabel('Mô tả').fill('');
await classDialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
await page.getByText('Đã lưu thông tin lớp.', { exact: true }).waitFor({ state: 'visible' });
const classPatch = requests.find((item) => item.method === 'PATCH' && item.path === `/admin/cohorts/${cohortId}`);
const classBody = JSON.parse(classPatch?.body || '{}');
check('edit lớp gửi explicit null và canonical reload', classBody.code_prefix === null && classBody.description === null && hasCanonicalReadAfter('PATCH', new RegExp(`/admin/cohorts/${cohortId}$`), `/admin/cohorts/${cohortId}/members`));

await page.getByRole('button', { name: 'Thêm học viên' }).click();
const memberDialog = page.getByRole('dialog');
await memberDialog.getByLabel('Học viên').selectOption('st-c');
check('chuyển lớp được cảnh báo trước mutation', await memberDialog.getByText(/Học viên hiện thuộc Lớp cũ/).count() === 1);
await memberDialog.getByRole('button', { name: 'Xếp vào lớp' }).click();
await page.getByText('Đã chuyển học viên sang lớp này.', { exact: true }).waitFor({ state: 'visible' });
check('xếp học viên rồi canonical reload', await page.getByText('Chi', { exact: true }).count() === 1 && hasCanonicalReadAfter('POST', new RegExp(`/admin/cohorts/${cohortId}/students$`), `/admin/cohorts/${cohortId}/members`));

await page.getByRole('tab', { name: /Tiến độ 4 kỹ năng/ }).click();
await page.locator('#acx-panel-progress tr').filter({ hasText: 'Chi' }).waitFor({ state: 'visible' });
check('xếp học viên làm mới tiến độ chuẩn', progressReadCount() > initialProgressReads && await page.locator('#acx-panel-progress tr').filter({ hasText: 'Chi' }).count() === 1);
const progressReadsAfterAdd = progressReadCount();
await page.getByRole('tab', { name: /Sổ điểm danh/ }).click();

failNextRoster = true;
await page.locator('tr').filter({ hasText: 'Chi' }).getByRole('button', { name: 'Gỡ khỏi lớp' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Gỡ khỏi lớp' }).click();
await page.getByText(/Đã gỡ học viên nhưng chưa đọc lại được sổ điểm danh chuẩn/).waitFor({ state: 'visible' });
check('write thành công nhưng reload lỗi báo stale thay vì báo success', await page.getByText(/Không đọc được sổ mới nhất/).count() === 1);

await page.getByRole('tab', { name: /Tiến độ 4 kỹ năng/ }).click();
await page.getByRole('heading', { name: 'Tiến độ 4 kỹ năng' }).waitFor({ state: 'visible' });
await page.locator('#acx-panel-progress tr').filter({ hasText: 'Chi' }).waitFor({ state: 'detached' });
check('gỡ học viên làm mới tiến độ dù roster reload lỗi', progressReadCount() > progressReadsAfterAdd && await page.locator('#acx-panel-progress tr').filter({ hasText: 'Chi' }).count() === 0);

await page.getByRole('tab', { name: /Buổi học/ }).click();
await page.getByRole('heading', { name: /Grammar 1/ }).waitFor({ state: 'visible' });
check('attachment scheme cũ nguy hiểm bị loại ở display boundary', await page.getByRole('link', { name: 'Unsafe' }).count() === 0);
await page.getByRole('button', { name: 'Sửa', exact: true }).click();
const lessonDialog = page.getByRole('dialog');
await lessonDialog.getByLabel('Buổi số').fill('');
await lessonDialog.getByLabel('Ngày học').fill('');
await lessonDialog.getByLabel('Nội dung').fill('');
failNextLessons = true;
await lessonDialog.getByRole('button', { name: 'Lưu buổi học' }).click();
await page.getByText(/Đã lưu buổi học nhưng chưa đọc lại được dòng thời gian chuẩn/).waitFor({ state: 'visible' });
const lessonPatch = requests.find((item) => item.method === 'PATCH' && item.path.endsWith('/lessons/lesson-1'));
const lessonBody = JSON.parse(lessonPatch?.body || '{}');
check('edit buổi gửi explicit null và stale reload warning', lessonBody.lesson_no === null && lessonBody.lesson_date === null && lessonBody.body_md === null && await page.getByText(/Danh sách dưới đây có thể đã cũ/).count() === 1);
check('edit trường khác không xoá attachment legacy', !Object.hasOwn(lessonBody, 'attachments'));

await page.getByRole('button', { name: 'Thêm buổi học' }).click();
const newDialog = page.getByRole('dialog');
await newDialog.getByLabel('Tiêu đề').fill('Grammar 2');
await newDialog.getByRole('button', { name: 'Thêm tài liệu' }).click();
await newDialog.getByLabel('Tên tài liệu 1').fill('Half');
await newDialog.getByRole('button', { name: 'Lưu buổi học' }).click();
check('tài liệu điền nửa dòng bị chặn trước request', await newDialog.getByText('Tài liệu 1 cần đủ tên và đường dẫn.', { exact: true }).count() === 1);
await newDialog.getByLabel('Đường dẫn tài liệu 1').fill('https://example.com/grammar2');
await newDialog.getByRole('button', { name: 'Lưu buổi học' }).click();
await page.getByText('Đã thêm buổi học.', { exact: true }).waitFor({ state: 'visible' });
check('tạo buổi rồi canonical reload', await page.getByRole('heading', { name: 'Grammar 2' }).count() === 1 && hasCanonicalReadAfter('POST', new RegExp(`/admin/cohorts/${cohortId}/lessons$`), `/admin/cohorts/${cohortId}/lessons`));

const grammar2 = page.locator('.acx-lesson').filter({ hasText: 'Grammar 2' });
await grammar2.getByRole('button', { name: 'Xoá' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Xoá buổi học' }).click();
await page.getByText('Đã xoá buổi học. Bài tập từng gắn với buổi này vẫn được giữ.', { exact: true }).waitFor({ state: 'visible' });
check('xoá buổi rồi canonical reload', await page.getByRole('heading', { name: 'Grammar 2' }).count() === 0 && hasCanonicalReadAfter('DELETE', /lessons\/lesson-new$/, `/admin/cohorts/${cohortId}/lessons`));

await page.goto(`${BASE}/admin/classes/${cohortId}?tab=lessons`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /Grammar 1/ }).waitFor({ state: 'visible' });
const lessonsTab = page.getByRole('tab', { name: /Buổi học/ });
check('deep-link tab được khôi phục và khai báo selected', await lessonsTab.getAttribute('aria-selected') === 'true' && new URL(page.url()).searchParams.get('tab') === 'lessons');
await lessonsTab.press('Home');
check('tab hỗ trợ bàn phím và cập nhật URL', await page.getByRole('tab', { name: /Sổ điểm danh/ }).getAttribute('aria-selected') === 'true' && new URL(page.url()).searchParams.get('tab') === 'roster');
failProgress = true;
const readsBeforeStickyFailure = progressReadCount();
await page.getByRole('tab', { name: /Tiến độ 4 kỹ năng/ }).click();
await page.getByText('Không đọc được tiến độ mới nhất', { exact: true }).waitFor({ state: 'visible' });
await page.waitForTimeout(250);
check('progress lỗi liên tục chỉ fetch một lần rồi chờ admin thử lại', progressReadCount() === readsBeforeStickyFailure + 1);
failProgress = false;

check('không có write ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nAdmin Class Detail native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
