// Fixture-backed browser contract for the native instructor compare + compose route.
// Every API call is intercepted; production data is never read or mutated.
//
//   node tooling/verify-instructor-compare-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const adminId = '00000000-0000-0000-0000-000000000095';
const instructorId = 'teacher/id';
const essayId = '00000000-0000-0000-0000-000000000096';
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
    access_token: 'instructor-compare-not-a-real-token',
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

const CRITERIA = ['mainCriterion', 'coherenceCohesion', 'lexicalResource', 'grammaticalRange'];
function feedback(version, bands) {
  return {
    overallBandScore: 6,
    overallBandScoreSummary: `Tổng quan từ bản ${version} <script>window.__previewXss=1</script>`,
    keyTakeaways: { strengths: [`Điểm mạnh bản ${version}`], areasForImprovement: ['Cải thiện độ chính xác'] },
    criteriaFeedback: Object.fromEntries(CRITERIA.map((key, index) => [key, {
      title: key,
      bandScore: bands[index],
      explanation: `Giải thích ${key} bản ${version}`,
      feedback: `Nhận xét ${key} bản ${version}`,
    }])),
    mistakeAnalysis: [{ type: 'Grammar', original: `Lỗi bản ${version}`, suggestion: `Sửa bản ${version}` }],
    improvedEssay: `Bài mẫu từ bản ${version}`,
    aiContentAnalysis: { likelihood: 5, explanation: 'Không có dấu hiệu bất thường.' },
  };
}

function version(version, source, bands) {
  const fj = feedback(version, bands);
  return {
    version, source, overall_band_score: fj.overallBandScore,
    created_at: `2026-08-${14 + version}T00:00:00Z`,
    criteriaFeedback: fj.criteriaFeedback,
    feedback_json: fj,
  };
}

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await seedSession(context, adminId, 'admin-compare@local');

let versions = [version(2, 'ai_pro', [7, 7, 7, 7]), version(1, 'ai_pro', [6, 6, 6, 6])];
let failCanonicalReadback = false;
const requests = [];
const composeBodies = [];
const unexpectedWrites = [];
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
  requests.push({ method, path, search: parsed.search });
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (path === '/auth/me') return json({ id: adminId, email: 'admin-compare@local', role: 'admin' });
  if (method === 'GET' && path === `/instructor/essays/${essayId}/versions`) {
    if (failCanonicalReadback) return json({ detail: 'fixture canonical read failed' }, 503);
    return json({ versions, budget: { live_count: versions.length, max: 3, can_compose: true } });
  }
  if (method === 'POST' && path === `/instructor/essays/${essayId}/compose`) {
    const body = request.postDataJSON();
    composeBodies.push(body);
    if (composeBodies.length === 1) {
      const composed = feedback(3, [7, 7, 7, 6]);
      composed.criteriaFeedback = {
        mainCriterion: versions[0].feedback_json.criteriaFeedback.mainCriterion,
        coherenceCohesion: versions[0].feedback_json.criteriaFeedback.coherenceCohesion,
        lexicalResource: versions[0].feedback_json.criteriaFeedback.lexicalResource,
        grammaticalRange: versions[1].feedback_json.criteriaFeedback.grammaticalRange,
      };
      composed.overallBandScore = 7;
      versions = [{
        version: 3, source: 'composed', overall_band_score: 7,
        created_at: '2026-08-17T00:00:00Z', criteriaFeedback: composed.criteriaFeedback,
        feedback_json: composed,
      }, ...versions];
    }
    return json({ essay_id: essayId, version: 3, source: 'composed' }, 201);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)
      && !/^POST \/api\/(analytics\/events|error-logs)$/.test(`${method} ${path}`)) unexpectedWrites.push(`${method} ${path}`);
  return json({});
});

await page.goto(`${BASE}/instructor/compare?essay_id=${essayId}&as_instructor=teacher%2Fid`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Chọn phiên bản tốt nhất cho từng tiêu chí' }).waitFor({ state: 'visible' });

const ownerReads = requests.filter((item) => item.method === 'GET' && item.path.startsWith('/instructor/'));
check('đọc đúng endpoint owner-scoped sau /auth/me', ownerReads.length === 1 && requests.findIndex((item) => item.path === '/auth/me') < requests.findIndex((item) => item.path.startsWith('/instructor/')));
check('GET versions mang đúng as_instructor', new URLSearchParams(ownerReads[0]?.search).get('as_instructor') === instructorId);
check('banner impersonation và back-link giữ context', await page.getByText(/Đang xem như giảng viên/).count() === 1
  && await page.getByRole('link', { name: 'Quay lại bài chấm' }).getAttribute('href') === `/instructor/grade?essay_id=${essayId}&as_instructor=teacher%2Fid`);
check('render đủ hai version và full base preview', await page.getByRole('columnheader', { name: 'v2 · AI' }).count() === 1
  && await page.getByText('Bài mẫu từ bản 2', { exact: true }).count() === 1);
check('renderer escape nội dung độc hại', await page.locator('.ic-preview-stack script').count() === 0 && await page.evaluate(() => !window.__previewXss));

await page.getByRole('radio', { name: /Band 6 Nhận xét grammaticalRange bản 1/ }).check();
await page.getByLabel('Nội dung còn lại lấy từ phiên bản').selectOption('1');
check('preview đổi base và tính Overall từ bốn lựa chọn', await page.getByText('Bài mẫu từ bản 1', { exact: true }).count() === 1
  && await page.getByLabel('Điểm tổng hợp xem trước').getByText('Band 7', { exact: true }).count() === 1);

const readsBeforeCompose = requests.filter((item) => item.method === 'GET' && item.path.endsWith('/versions')).length;
await page.getByRole('button', { name: 'Tạo bản ghép và đặt hiện hành' }).click();
await page.getByText('Đã tạo bản ghép và xác nhận phiên bản hiện hành từ dữ liệu canonical.', { exact: true }).waitFor({ state: 'visible' });
const readsAfterCompose = requests.filter((item) => item.method === 'GET' && item.path.endsWith('/versions')).length;
check('POST body giữ nguyên whole-criterion picks và base', JSON.stringify(composeBodies[0]) === JSON.stringify({
  base_version: 1, mainCriterion: 2, coherenceCohesion: 2, lexicalResource: 2, grammaticalRange: 1,
}));
check('mutation thành công reload canonical đúng một lần', composeBodies.length === 1 && readsAfterCompose === readsBeforeCompose + 1);
check('readback hiển thị bản ghép hiện hành', await page.getByRole('columnheader', { name: 'v3 · Bản ghép' }).count() === 1);

failCanonicalReadback = true;
await page.getByRole('button', { name: 'Tạo bản ghép và đặt hiện hành' }).click();
await page.getByText(/đã được gửi nhưng chưa xác nhận được trạng thái canonical/).waitFor({ state: 'visible' });
check('readback lỗi không replay POST và không báo thành công giả', composeBodies.length === 2
  && await page.getByText(/hệ thống không tự gửi lại mutation/).count() === 1);
check('trạng thái bất định khóa POST và chỉ cho canonical read', await page.getByRole('button', { name: 'Đọc lại trạng thái' }).count() === 1
  && await page.getByRole('button', { name: 'Tạo bản ghép và đặt hiện hành' }).count() === 0);
check('mobile không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await page.setViewportSize({ width: 1440, height: 900 });
check('desktop không tràn ngang', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check('không có write ngoài compose fixture', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));

const deniedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
await seedSession(deniedContext, 'student-compare', 'student@local');
const deniedPage = await deniedContext.newPage();
const deniedReads = [];
await deniedPage.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url);
  if (parsed.pathname.startsWith('/instructor/')) deniedReads.push(`${request.method()} ${parsed.pathname}`);
  const body = parsed.pathname === '/auth/me'
    ? { id: 'student-compare', email: 'student@local', role: 'student' }
    : {};
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await deniedPage.goto(`${BASE}/instructor/compare?essay_id=${essayId}&as_instructor=${instructorId}`, { waitUntil: 'domcontentloaded' });
await deniedPage.getByRole('alert').getByText('Bạn không có quyền truy cập trang giảng viên.', { exact: true }).waitFor({ state: 'visible' });
check('student bị chặn trước mọi owner read', deniedReads.length === 0, deniedReads.join(', '));

await deniedContext.close();
await context.close();
await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nInstructor compare native flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
