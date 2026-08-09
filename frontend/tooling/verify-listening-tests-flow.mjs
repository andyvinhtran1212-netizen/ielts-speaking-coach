// Browser-backed contract for the native `/listening/tests` behavior.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/listening/tests';
const fakeSession = JSON.stringify({
  access_token: 'listening-tests-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000035', email: 'listening-tests@local' },
});
const payload = {
  items: [{
    id: 'draft-attempt', test_id: 'CAM-01', title: 'Title <script> alert',
    band_target: 7, themes: { s1: 'Travel', s2: 'Education' },
    user_best_score: null, user_attempt_count: 2, user_submitted_attempt_count: 0,
  }, {
    id: 'submitted-attempt', test_id: 'CAM-02', title: 'Completed test',
    user_best_score: 34, user_attempt_count: 3, user_submitted_attempt_count: 1,
  }],
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
const observedQueries = [];
let scenario = 'malformed';
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/\/api\/listening\/tests\?/.test(url)) {
    const parsed = new URL(url);
    observedQueries.push({
      limit: parsed.searchParams.get('limit'),
      offset: parsed.searchParams.get('offset'),
      testType: parsed.searchParams.get('test_type'),
    });
    if (scenario === 'error') {
      return route.fulfill({
        status: 500, contentType: 'application/json', body: '{"detail":"secret-listening-detail"}',
      });
    }
    const body = scenario === 'malformed'
      ? { items: [null, 'bad', { id: '' }] }
      : payload;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.locator('#state-empty').waitFor({ state: 'visible' });
check('payload lỗi hình dạng render empty state', await page.locator('#state-empty').isVisible());
check('summary phân biệt danh sách rỗng với trạng thái đang tải',
  (await page.locator('#lt-total-count').innerText()).trim() === '0');

scenario = 'valid';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.lt-card').first().waitFor({ state: 'visible' });
check('summary và card lấy dữ liệu thật',
  (await page.locator('#lt-total-count').innerText()).trim() === '2'
    && await page.locator('.lt-card').count() === 2);
check('authored title được React escape',
  (await page.locator('.lt-card-title').first().innerText()) === 'Title <script> alert'
    && await page.locator('.lt-card script').count() === 0);
check('attempt dang dở không bị gắn nhãn Đã làm',
  await page.locator('[data-test-id="draft-attempt"]').getAttribute('data-status') === 'new'
    && (await page.locator('[data-test-id="draft-attempt"] .lt-card-status').innerText()) === 'Chưa làm'
    && (await page.locator('[data-test-id="draft-attempt"] .lt-card-stats').innerText()).includes('2 lượt làm'));
check('attempt submitted hiển thị điểm và CTA làm lại',
  await page.locator('[data-test-id="submitted-attempt"]').getAttribute('data-status') === 'done'
    && (await page.locator('[data-test-id="submitted-attempt"] .lt-card-stats').innerText()).includes('34/40')
    && (await page.locator('[data-test-id="submitted-attempt"] .lt-card-cta').first().innerText()).includes('Làm lại'));
check('card giữ cấu trúc đề và hai đích hành động',
  (await page.locator('[data-test-id="draft-attempt"] .lt-card-facts').innerText()).includes('40 câu')
    && (await page.locator('[data-test-id="draft-attempt"] .lt-card-cta').first().getAttribute('href'))
      === '/pages/listening-test.html?id=draft-attempt&from=full'
    && (await page.locator('[data-test-id="draft-attempt"] .lt-card-cta').nth(1).getAttribute('href'))
      === '/pages/listening-test-dictation.html?test_id=draft-attempt');

await page.getByRole('button', { name: 'Đã làm', exact: true }).click();
check('lọc Đã làm dựa trên submitted attempt',
  await page.locator('.lt-card').count() === 1
    && await page.locator('[data-test-id="submitted-attempt"]').isVisible()
    && (await page.locator('#lt-visible-count').innerText()).trim() === '1 đề thi');
await page.getByRole('button', { name: 'Chưa làm', exact: true }).click();
check('lọc Chưa làm vẫn giữ attempt dang dở',
  await page.locator('.lt-card').count() === 1
    && await page.locator('[data-test-id="draft-attempt"]').isVisible());
check('request dùng đúng full-test paging contract',
  observedQueries.every((query) => query.limit === '100'
    && query.offset === '0' && query.testType === 'full'));

scenario = 'error';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#state-error').waitFor({ state: 'visible' });
check('lỗi backend dùng thông báo chung, không lộ chi tiết raw',
  !(await page.locator('#state-error').innerText()).includes('secret-listening-detail'));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
