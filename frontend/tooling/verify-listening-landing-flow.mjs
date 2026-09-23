// Browser-backed contract for the native `/listening` landing behavior.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/listening';
const fakeSession = JSON.stringify({
  access_token: 'listening-landing-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000039', email: 'listening-landing@local' },
});
const validOverview = {
  tests: { full: 2, mini: 0, drill: 4, practice: 3 },
  content: 5,
  exercise_modes: { dictation: 1, gist: 0, true_false: 0, mcq: '2', mini_test: 99, unknown: 7 },
  programmes: [
    {
      id: 'general-listening-practice', title: 'General Listening', description: 'General programme',
      lesson_count: 56, form_count: 143, completed_form_count: 7, independent_completed_form_count: 5, in_progress_form_count: 1,
    },
    {
      id: 'ielts-listening-practice', title: 'IELTS Listening', description: 'IELTS programme',
      lesson_count: 10, form_count: 16, completed_form_count: 2, independent_completed_form_count: 2, in_progress_form_count: 0,
    },
  ],
  resume: {
    attempt_id: 'attempt-resume', test_id: 'test-resume', title: 'General 01 — Form A',
    programme_id: 'general-listening-practice', answered_count: 3, item_count: 10, assisted: true,
    resume_expires_at: '2026-09-22T10:00:00Z',
    href: '/listening/programmes/form/test-resume?attempt=attempt-resume',
  },
  recent: [
    {
      attempt_id: 'attempt-recent', title: 'IELTS Practice 01', programme_id: 'ielts-listening-practice',
      checked_count: 4, correct_count: 3, unscored_count: 6, assisted: true,
      href: '/listening/programmes/result/attempt-recent',
    },
  ],
  partial_data: true,
};
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
async function launchChromium() {
  try { return await chromium.launch(); } catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) {
      return chromium.launch({ executablePath: localChrome });
    }
    throw error;
  }
}

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(([key, value]) => {
  try { localStorage.setItem(key, value); } catch (_) {}
}, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const pageErrors = [];
const overviewRequests = [];
let scenario = 'malformed';
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/\/api\/listening\/overview(?:\?|$)/.test(url)) {
    overviewRequests.push(url);
    if (scenario === 'error') {
      return route.fulfill({
        status: 500, contentType: 'application/json', body: '{"detail":"secret-listening-detail"}',
      });
    }
    const body = scenario === 'malformed'
      ? { tests: 'bad', content: '5', exercise_modes: null }
      : scenario === 'no-programmes'
        ? { ...validOverview, programmes: [], resume: null, recent: [], partial_data: false }
        : scenario === 'general-only'
          ? { ...validOverview, programmes: [validOverview.programmes[0]], resume: null, recent: [], partial_data: false }
      : scenario === 'no-modes'
        ? { ...validOverview, content: 5, exercise_modes: {}, resume: null, recent: [], partial_data: false }
        : validOverview;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.locator('#listening-next-title').waitFor({ state: 'visible' });
check('payload lỗi hình dạng trở thành gợi ý an toàn',
  (await page.locator('#listening-next-title').innerText()).includes('Chọn một bài nghe')
    && (await page.locator('.listening-resume a').getAttribute('href')) === '/listening/analytics'
    && await page.locator('.listening-programme-card').count() === 1
    && (await page.locator('.listening-programme-card').getAttribute('href')) === '/listening/ielts');
check('content không đúng kiểu số không mở library',
  await page.locator('#section-library').count() === 0);
check('analytics luôn còn lối vào', await page.locator('[data-mode="analytics"]').isVisible());

scenario = 'no-programmes';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.listening-programme-card').waitFor({ state: 'visible' });
check('IELTS hub vẫn hiện khi chưa package nào được publish',
  await page.locator('.listening-programme-card').count() === 1
    && (await page.locator('.listening-programme-card').getAttribute('href')) === '/listening/ielts');

scenario = 'general-only';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.listening-programme-card').nth(1).waitFor({ state: 'visible' });
check('IELTS hub vẫn hiện khi chỉ General được publish',
  await page.locator('.listening-programme-card').count() === 2
    && (await page.locator('.listening-programme-card').nth(0).getAttribute('href')) === '/listening/general'
    && (await page.locator('.listening-programme-card').nth(1).getAttribute('href')) === '/listening/ielts');

scenario = 'valid';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#listening-resume-title').waitFor({ state: 'visible' });
check('ưu tiên đúng bài programme đang làm dở',
  (await page.locator('#listening-resume-title').innerText()) === 'General 01 — Form A'
    && (await page.locator('.listening-resume a').getAttribute('href')) === '/listening/programmes/form/test-resume?attempt=attempt-resume'
    && (await page.locator('.listening-resume').innerText()).includes('lượt học có hỗ trợ'));
check('render đủ hai chương trình cùng tiến độ canonical',
  await page.locator('.listening-programme-card').count() === 2
    && (await page.locator('.listening-programme-card').nth(0).getAttribute('href')) === '/listening/general'
    && (await page.locator('.listening-programme-card').nth(1).getAttribute('href')) === '/listening/ielts'
    && (await page.locator('.listening-programme-card').nth(0).locator('[role="progressbar"]').getAttribute('aria-valuenow')) === '5');
check('hoạt động gần đây trỏ tới kết quả report-only',
  (await page.locator('.listening-recent__list a').getAttribute('href')) === '/listening/programmes/result/attempt-recent'
    && (await page.locator('.listening-recent__result').innerText()).includes('3/4 câu tự động kiểm tra')
    && (await page.locator('.listening-recent__list small').innerText()).includes('có hỗ trợ'));
check('library chỉ mở khi có content và runnable mode',
  await page.locator('#section-library').isVisible()
    && (await page.locator('[data-mode="browse"] .mode-card__badge').textContent())?.trim() === '5 bài');
const browseLede = await page.locator('[data-mode="browse"] .lede').innerText();
check('mode labels dùng allowlist đúng thứ tự, bỏ mini_test và unknown',
  browseLede.includes('Chép chính tả · Trắc nghiệm')
    && !browseLede.includes('mini_test') && !browseLede.includes('unknown'));
check('mọi card giữ đúng destination',
  (await page.locator('[data-mode="browse"]').getAttribute('href')) === '/listening/browse'
    && (await page.locator('[data-mode="analytics"]').getAttribute('href')) === '/listening/analytics');
check('partial-data warning không che giấu trạng thái tiến độ',
  (await page.locator('.error-banner[role="status"]').innerText()).includes('Một phần tiến độ'));

scenario = 'no-modes';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#listening-next-title').waitFor({ state: 'visible' });
check('content rows đơn lẻ không tạo dead-end library card',
  await page.locator('#section-library').count() === 0
    && await page.locator('.listening-programme-card').count() === 2);

scenario = 'error';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#landing-error').waitFor({ state: 'visible' });
check('API lỗi vẫn mở hai thư viện programme mà không bịa count',
  await page.locator('.listening-programme-card').count() === 2
    && (await page.locator('.listening-programme-card').nth(0).getAttribute('href')) === '/listening/general'
    && (await page.locator('.listening-programme-card').nth(1).getAttribute('href')) === '/listening/ielts'
    && await page.locator('.listening-programme-card__progress').count() === 0);
check('API lỗi không mở content library chưa xác minh',
  await page.locator('#section-library').count() === 0);
check('thông báo lỗi chung không lộ chi tiết backend',
  !(await page.locator('#landing-error').innerText()).includes('secret-listening-detail'));
check('request dùng đúng canonical overview endpoint',
  overviewRequests.length === 6
    && overviewRequests.every((url) => new URL(url).pathname === '/api/listening/overview'));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
