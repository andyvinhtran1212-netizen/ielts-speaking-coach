// Fixture-backed browser contract for native instructor Writing review.
// All APIs are intercepted; production data is never read or mutated.
//
//   node tooling/verify-instructor-grade-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000097';
const instructorId = '00000000-0000-0000-0000-000000000098';
const essayId = '00000000-0000-0000-0000-000000000099';
const reviewId = '00000000-0000-0000-0000-000000000100';
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

function fakeSession(userId, email) {
  return JSON.stringify({
    access_token: 'instructor-grade-not-a-real-token',
    refresh_token: 'x', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, email },
  });
}

async function seedSession(context, userId, email) {
  await context.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, value); } catch (_) {}
  }, [storageKey(SB), fakeSession(userId, email)]);
}

const feedbackJson = {
  overallBandScoreSummary: 'Tổng quan <script>window.__gradeXss=1</script>',
  keyTakeaways: { strengths: ['Lập luận rõ'], areasForImprovement: ['Thêm ví dụ'] },
  criteriaFeedback: {
    mainCriterion: { bandScore: 6.5, feedback: 'Đủ ý' },
    coherenceCohesion: { bandScore: 6, feedback: 'Mạch lạc' },
    lexicalResource: { bandScore: 6.5, feedback: 'Từ vựng phù hợp' },
    grammaticalRange: { bandScore: 6, feedback: 'Cần đa dạng câu' },
  },
  mistakeAnalysis: [{ original: '<img src=x onerror="window.__essayXss=1">', correction: 'Safe correction', type: 'Grammar' }],
  improvedEssay: 'Bài mẫu an toàn.',
};

let essay = {
  id: essayId,
  status: 'graded',
  task_type: 'task2',
  essay_text: '<img src=x onerror="window.__essayXss=1"> This must stay text.',
  instructor_note: '',
  delivered_at: null,
  is_flagged: false,
  student: { id: 'student-1', full_name: 'Nguyễn Minh Anh', student_code: 'HV-0412', target_band: 7 },
  feedback: { version: 2, overall_band_score: 6.5, feedback_json: feedbackJson },
};
let reviewStatus = 'claimed';
let failReadback = false;
const versions = [
  { version: 2, source: 'ai_pro', overall_band_score: 6.5, created_at: '2026-08-16T00:00:00Z', feedback_json: feedbackJson },
  { version: 1, source: 'ai_pro', overall_band_score: 6, created_at: '2026-08-15T00:00:00Z', feedback_json: feedbackJson },
];

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await seedSession(context, adminId, 'admin-grade@local');
const requests = [];
const writes = [];
const pageErrors = [];
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
  const body = ['POST', 'PATCH'].includes(method) ? request.postDataJSON() : null;
  requests.push({ method, path, search: parsed.search, body });
  if (['POST', 'PATCH'].includes(method) && !path.startsWith('/api/')) writes.push({ method, path, search: parsed.search, body });
  const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

  if (path === '/auth/me') return json({ id: adminId, email: 'admin-grade@local', role: 'admin' });
  if (method === 'GET' && path === `/instructor/essays/${essayId}`) {
    if (failReadback) return json({ detail: 'fixture readback unavailable' }, 503);
    return json(essay);
  }
  if (method === 'GET' && path === `/instructor/essays/${essayId}/versions`) {
    return json({ versions, budget: { live_count: versions.length, max: 3, can_compose: true } });
  }
  if (method === 'GET' && path === '/instructor/reviews/queue') {
    return json(reviewStatus === 'delivered' ? [] : [{
      essay_id: essayId,
      review: { id: reviewId, status: reviewStatus },
      student_email: 'student@local', task_type: 'task2',
    }]);
  }
  if (method === 'PATCH' && path === `/instructor/essays/${essayId}/instructor-note`) {
    essay = { ...essay, instructor_note: body.instructor_note, status: essay.status === 'graded' ? 'reviewed' : essay.status };
    return json({ essay_id: essayId, instructor_note: body.instructor_note, status: essay.status });
  }
  if (method === 'POST' && path === `/instructor/reviews/${reviewId}/deliver`) {
    reviewStatus = 'delivered';
    essay = { ...essay, instructor_note: body.instructor_note, status: 'delivered', delivered_at: '2026-08-16T08:00:00Z' };
    return json({ id: reviewId, essay_id: essayId, status: 'delivered' });
  }
  if (method === 'POST' && path === `/instructor/essays/${essayId}/revoke-delivery`) {
    reviewStatus = 'claimed';
    essay = { ...essay, status: 'reviewed', delivered_at: null };
    return json({ essay_id: essayId, status: 'reviewed' });
  }
  if (method === 'POST' && path === `/instructor/essays/${essayId}/regrade`) {
    essay = { ...essay, status: 'grading' };
    failReadback = true;
    return json({ essay_id: essayId, status: 'grading' }, 202);
  }
  return json({});
});

await page.goto(`${BASE}/instructor/grade?essay_id=${essayId}&review_id=${reviewId}&as_instructor=${instructorId}`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Nguyễn Minh Anh' }).waitFor({ state: 'visible' });

const ownerReads = requests.filter((item) => item.method === 'GET' && item.path.startsWith('/instructor/'));
check('role gate chạy trước ba owner reads', ownerReads.length === 3
  && requests.findIndex((item) => item.path === '/auth/me') < requests.findIndex((item) => item.path.startsWith('/instructor/')));
check('mọi owner read giữ đúng impersonation', ownerReads.every((item) => new URLSearchParams(item.search).get('as_instructor') === instructorId));
check('hiển thị canonical student, band, note và hai version', await page.locator('#ig-student').getByText('Nguyễn Minh Anh', { exact: true }).count() === 1
  && await page.locator('#ig-band').getByText('Band 6.5', { exact: true }).count() === 1
  && await page.getByText('2/3', { exact: true }).count() === 1);
check('renderer và essay canvas không thực thi nội dung độc hại', await page.locator('#ig-ai script').count() === 0
  && await page.locator('#ig-essay img').count() === 0
  && await page.evaluate(() => !window.__gradeXss && !window.__essayXss));
check('compare link là route native và giữ impersonation', await page.locator('#ig-compare').getAttribute('href') === `/instructor/compare?essay_id=${essayId}&as_instructor=${instructorId}`);

const note = 'Ý tưởng rõ; đoạn hai cần thêm một ví dụ cụ thể.';
await page.locator('#ig-comment').fill(note);
await page.locator('#ig-deliver').click();
await page.getByText('Đã trả bài và xác nhận trạng thái học viên nhìn thấy từ dữ liệu canonical.', { exact: true }).waitFor({ state: 'visible' });
const deliveryWrites = writes.filter((item) => item.path.includes('/instructor-note') || item.path.endsWith('/deliver'));
check('lưu note đứng trước deliver và mỗi mutation đúng một lần', deliveryWrites.length === 2
  && deliveryWrites[0].method === 'PATCH' && deliveryWrites[1].method === 'POST');
check('deliver body buộc đúng essay + review context', JSON.stringify(deliveryWrites[1]?.body) === JSON.stringify({ essay_id: essayId, instructor_note: note }));
check('hai write đều mang as_instructor', deliveryWrites.every((item) => new URLSearchParams(item.search).get('as_instructor') === instructorId));
check('canonical delivery mở nút thu hồi và khóa trả lần hai', await page.locator('#ig-revoke').isVisible()
  && await page.locator('#ig-deliver').isDisabled());

await page.locator('#ig-revoke').click();
check('thu hồi dùng dialog accessible thay vì browser confirm', await page.getByRole('dialog', { name: 'Thu hồi bài đã trả?' }).count() === 1);
await page.getByRole('button', { name: 'Thu hồi bài', exact: true }).click();
await page.getByText('Đã thu hồi và xác nhận bài không còn hiển thị cho học viên.', { exact: true }).waitFor({ state: 'visible' });
check('revoke gửi đúng một POST và canonical trở lại reviewed', writes.filter((item) => item.path.endsWith('/revoke-delivery')).length === 1
  && await page.getByText('Đã nhận xét', { exact: true }).count() === 1);

await page.locator('#ig-regrade').click();
check('regrade giải thích tạo bản mới và giữ bản cũ', await page.getByRole('dialog').getByText(/Các phiên bản cũ/).count() === 1);
await page.getByRole('dialog').getByRole('button', { name: 'Chấm lại bằng AI' }).click();
await page.getByText(/Chưa xác nhận được trạng thái canonical/).waitFor({ state: 'visible' });
check('readback lỗi khóa mutation và không replay regrade', writes.filter((item) => item.path.endsWith('/regrade')).length === 1
  && await page.getByRole('button', { name: 'Đọc lại trạng thái' }).count() === 1);
check('mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

const deniedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
await seedSession(deniedContext, 'student-grade', 'student@local');
const deniedPage = await deniedContext.newPage();
const deniedReads = [];
await deniedPage.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url);
  if (parsed.pathname.startsWith('/instructor/')) deniedReads.push(`${request.method()} ${parsed.pathname}`);
  const body = parsed.pathname === '/auth/me' ? { id: 'student-grade', email: 'student@local', role: 'student' } : {};
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await deniedPage.goto(`${BASE}/instructor/grade?essay_id=${essayId}&review_id=${reviewId}`, { waitUntil: 'domcontentloaded' });
await deniedPage.getByRole('alert').getByText('Bạn không có quyền truy cập trang giảng viên.', { exact: true }).waitFor({ state: 'visible' });
check('student bị chặn trước mọi owner read', deniedReads.length === 0, deniedReads.join(', '));

await deniedContext.close();
await context.close();
await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nInstructor grade native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
