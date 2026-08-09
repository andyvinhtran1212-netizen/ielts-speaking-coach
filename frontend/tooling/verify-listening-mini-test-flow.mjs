// Browser-backed contract for the native `/listening/mini-test` behavior.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/listening/mini-test';
const fakeSession = JSON.stringify({
  access_token: 'listening-mini-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000036', email: 'listening-mini@local' },
});
const payload = {
  items: [{
    id: 'mini-draft', test_id: 'MINI-01', title: 'MINI-01', band_target: 6.5,
    themes: { s1: 'Travel <script>', s2: 'Work' }, user_best_score: null,
    user_attempt_count: 2, user_submitted_attempt_count: 0,
  }, {
    id: 'mini-done', test_id: 'MINI-02', title: 'Completed mini',
    user_best_score: 8, user_attempt_count: 3, user_submitted_attempt_count: 1,
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
        status: 500, contentType: 'application/json', body: '{"detail":"secret-mini-detail"}',
      });
    }
    const body = scenario === 'malformed' ? { items: [null, 'bad', { id: '' }] } : payload;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.locator('#state-empty').waitFor({ state: 'visible' });
check('payload lỗi hình dạng render empty state', await page.locator('#state-empty').isVisible());
check('summary rỗng hiển thị ba số 0 thật',
  (await page.locator('#lt-total-count').innerText()).trim() === '0'
    && (await page.locator('#lt-new-count').innerText()).trim() === '0'
    && (await page.locator('#lt-done-count').innerText()).trim() === '0');

scenario = 'valid';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.lt-card').first().waitFor({ state: 'visible' });
check('summary tính theo submitted attempt',
  (await page.locator('#lt-total-count').innerText()).trim() === '2'
    && (await page.locator('#lt-new-count').innerText()).trim() === '1'
    && (await page.locator('#lt-done-count').innerText()).trim() === '1');
check('title trùng code dùng fallback và theme được React escape',
  (await page.locator('[data-test-id="mini-draft"] .lt-card-title').innerText()) === 'Mini Listening Test'
    && (await page.locator('[data-test-id="mini-draft"] .lt-card-meta').innerText()).includes('Travel <script>')
    && await page.locator('.lt-card script').count() === 0);
check('attempt dang dở vẫn thuộc nhóm Chưa làm',
  await page.locator('[data-test-id="mini-draft"]').getAttribute('data-status') === 'new'
    && (await page.locator('[data-test-id="mini-draft"] .lt-card-status').innerText()) === 'Chưa làm'
    && (await page.locator('[data-test-id="mini-draft"] .lt-card-stats').innerText()).includes('2 lần'));
const doneStats = await page.locator('[data-test-id="mini-done"] .lt-card-stats').innerText();
check('điểm mini không bịa mẫu số /40', doneStats.includes('8 điểm') && !doneStats.includes('/40'));
check('card giữ đúng player origin và dictation destination',
  (await page.locator('[data-test-id="mini-draft"] .lt-card-cta').first().getAttribute('href'))
      === '/pages/listening-test.html?id=mini-draft&from=mini'
    && (await page.locator('[data-test-id="mini-draft"] .lt-card-cta').nth(1).getAttribute('href'))
      === '/pages/listening-test-dictation.html?test_id=mini-draft');

await page.getByRole('button', { name: 'Đã luyện', exact: true }).click();
check('lọc Đã luyện chỉ giữ attempt đã submitted',
  await page.locator('.lt-card').count() === 1
    && await page.locator('[data-test-id="mini-done"]').isVisible());
await page.getByRole('button', { name: 'Chưa làm', exact: true }).click();
check('lọc Chưa làm giữ attempt chưa nộp',
  await page.locator('.lt-card').count() === 1
    && await page.locator('[data-test-id="mini-draft"]').isVisible());
check('request dùng đúng mini-test paging contract',
  observedQueries.every((query) => query.limit === '100'
    && query.offset === '0' && query.testType === 'mini'));

scenario = 'error';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#state-error').waitFor({ state: 'visible' });
check('lỗi backend dùng thông báo chung, không lộ chi tiết raw',
  !(await page.locator('#state-error').innerText()).includes('secret-mini-detail'));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
