// Browser-backed contract for the native `/reading/test` behavior.
// Uses a fake Supabase session and a fully intercepted backend.
//
//   node tooling/verify-reading-test-flow.mjs [base]
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/reading/test';

const fakeSession = JSON.stringify({
  access_token: 'reading-test-flow-not-a-real-token',
  refresh_token: 'x',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000032', email: 'reading-test@local' },
});

const initialPayload = {
  total: 3,
  items: [{
    id: 'full-initial',
    test_id: 'FULL-01',
    title: 'Full <script> Test',
    module: 'academic',
    passage_count: 3,
    total_questions: 40,
    time_limit_minutes: 60,
    band_target: 7.5,
  }],
};

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

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(([key, value]) => {
  try { localStorage.setItem(key, value); } catch (_) {}
}, [storageKey(SB), fakeSession]);

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

let scenario = 'malformed';
let releaseAcademic;
let academicStartedResolve;
let academicStarted = new Promise((resolve) => { academicStartedResolve = resolve; });
let academicRelease = new Promise((resolve) => { releaseAcademic = resolve; });
const observedQueries = [];

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();

  if (/\/api\/reading\/test\?/.test(url)) {
    const parsed = new URL(url);
    const module = parsed.searchParams.get('module') || '';
    observedQueries.push({
      module,
      limit: parsed.searchParams.get('limit'),
      testType: parsed.searchParams.get('test_type'),
    });

    if (scenario === 'error') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'secret-backend-detail' }),
      });
    }

    if (scenario === 'malformed') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 'bad', items: [null, 'bad', { test_id: '' }] }),
      });
    }

    if (module === 'academic') {
      academicStartedResolve();
      await academicRelease;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: 1,
          items: [{
            id: 'old', test_id: 'OLD', title: 'Kết quả cũ', module: 'academic',
            passage_count: 3, total_questions: 40, time_limit_minutes: 60,
          }],
        }),
      }).catch(() => {});
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(initialPayload),
    });
  }

  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) {
    return route.continue();
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

// 1. Malformed data becomes a truthful empty result.
await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.locator('#state-empty').waitFor({ state: 'visible' });
check('payload lỗi hình dạng render empty state, không làm vỡ trang',
  (await page.locator('#state-empty').innerText()).includes('Chưa có bài thi'));
check('canonical total lỗi hình dạng rơi về số card hợp lệ',
  (await page.locator('#rv-total-count').innerText()).trim() === '0');
check('summary malformed vẫn nói đúng 0 đề',
  (await page.locator('#rv-result-count').innerText()).trim() === '0 đề thi đầy đủ');

// 2. Valid data preserves canonical total, rich cards and authored content.
scenario = 'valid';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.rv-card').waitFor({ state: 'visible' });
check('API exact total khác số card được hiển thị rõ',
  (await page.locator('#rv-result-count').innerText()).trim()
    === '3 đề thi đầy đủ · đang hiển thị 1');
check('hero dùng cùng canonical total',
  (await page.locator('#rv-total-count').innerText()).trim() === '3');
check('card redesign có top, facts, footer và CTA',
  await page.locator('.rv-card__top').count() === 1
    && await page.locator('.rv-card__facts').count() === 1
    && await page.locator('.rv-card__footer').count() === 1
    && (await page.locator('.rv-card__cta').innerText()).includes('Bắt đầu bài thi'));
check('authored title được escape, không tạo script node',
  (await page.locator('.rv-card h3').innerText()) === 'Full <script> Test'
    && await page.locator('.rv-card script').count() === 0);
check('card có accessible name và origin stamp đúng',
  await page.locator('.rv-card').getAttribute('aria-label') === 'Bắt đầu bài thi Full <script> Test'
    && (await page.locator('.rv-card').getAttribute('href'))
      === '/core-player/launch?surface=reading_exam&test_id=FULL-01&from=full');
const factsText = (await page.locator('.rv-card__facts').innerText()).replace(/\s+/g, ' ');
const footerText = (await page.locator('.rv-card__footer').innerText()).replace(/\s+/g, ' ');
check('facts và band target dùng dữ liệu canonical',
  factsText.includes('3 đoạn văn')
    && factsText.includes('40 câu hỏi')
    && factsText.includes('60 phút')
    && footerText.includes('MỤC TIÊU BAND 7.5'));

// 3. Reset starts a new request and the slow filtered response stays stale.
await page.locator('#filter-module').selectOption('academic');
await academicStarted;
check('nút Xóa lọc chỉ hiện khi có filter', await page.locator('#clear-filters').isVisible());
await page.locator('#clear-filters').click();
await page.getByText('Full <script> Test', { exact: true }).waitFor({ state: 'visible' });
releaseAcademic();
await page.waitForTimeout(250);
check('response filter cũ không ghi đè response mới',
  await page.getByText('Full <script> Test', { exact: true }).count() === 1
    && await page.getByText('Kết quả cũ', { exact: true }).count() === 0);
check('Xóa lọc reset mô-đun và ẩn lại',
  await page.locator('#filter-module').inputValue() === ''
    && !(await page.locator('#clear-filters').isVisible()));
check('mọi request giữ limit=50 và test_type=full',
  observedQueries.every((query) => query.limit === '50' && query.testType === 'full')
    && observedQueries.some((query) => query.module === 'academic'));

// 4. Backend details must not leak into learner-facing errors.
scenario = 'error';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#state-error').waitFor({ state: 'visible' });
check('lỗi backend dùng thông báo chung, không lộ chi tiết raw',
  (await page.locator('#state-error').innerText()).includes('Vui lòng thử lại')
    && !(await page.locator('#state-error').innerText()).includes('secret-backend-detail'));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
