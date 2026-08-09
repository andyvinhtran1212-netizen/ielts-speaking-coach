// Browser-backed contract for the native `/reading/mini-test` behavior.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/reading/mini-test';
const fakeSession = JSON.stringify({
  access_token: 'reading-mini-test-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000033', email: 'reading-mini@local' },
});
const initialPayload = {
  total: 5,
  items: [{
    id: 'mini-one', test_id: 'MINI-01', title: 'Mini <script> Test', module: 'academic',
    passage_count: 1, total_questions: 12, time_limit_minutes: 20, band_target: 7,
  }, {
    id: 'mini-default', test_id: 'MINI-DEFAULT', title: '', module: 'academic',
  }, {
    id: 'mini-three', test_id: 'MINI-03', title: 'Mini 03', module: 'academic',
    passage_count: 1, total_questions: 10, time_limit_minutes: 20,
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
page.on('pageerror', (error) => pageErrors.push(String(error)));
let scenario = 'malformed';
let releaseAcademic;
let academicStartedResolve;
const academicStarted = new Promise((resolve) => { academicStartedResolve = resolve; });
const academicRelease = new Promise((resolve) => { releaseAcademic = resolve; });
const observedQueries = [];

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/\/api\/reading\/test\?/.test(url)) {
    const parsed = new URL(url);
    const module = parsed.searchParams.get('module') || '';
    observedQueries.push({ module, limit: parsed.searchParams.get('limit'), testType: parsed.searchParams.get('test_type') });
    if (scenario === 'error') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"secret-mini-detail"}' });
    }
    if (scenario === 'malformed') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ total: 'bad', items: [null, 'bad', { test_id: '' }] }),
      });
    }
    if (module === 'academic') {
      academicStartedResolve();
      await academicRelease;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ total: 1, items: [{ id: 'old', test_id: 'OLD', title: 'Kết quả cũ' }] }),
      }).catch(() => {});
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(initialPayload) });
  }
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.locator('#state-empty').waitFor({ state: 'visible' });
check('payload lỗi hình dạng render empty state', await page.locator('#state-empty').isVisible());
check('malformed total và duration đều truthful',
  (await page.locator('#rv-total-count').innerText()).trim() === '0'
    && (await page.locator('#rv-duration-count').innerText()).trim() === '—'
    && (await page.locator('#rv-result-count').innerText()).trim() === '0 mini test');

scenario = 'valid';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.rv-card').first().waitFor({ state: 'visible' });
check('canonical total phân biệt với số card',
  (await page.locator('#rv-result-count').innerText()).trim() === '5 mini test · đang hiển thị 3'
    && (await page.locator('#rv-total-count').innerText()).trim() === '5');
check('duration phổ biến được tính từ dữ liệu thật',
  (await page.locator('#rv-duration-count').innerText()).trim() === '20 phút');
check('card redesign có top, facts, footer và CTA',
  await page.locator('.rv-card__top').count() === 3
    && await page.locator('.rv-card__facts').count() === 3
    && await page.locator('.rv-card__footer').count() === 3
    && (await page.locator('.rv-card__cta').first().innerText()).includes('Bắt đầu mini test'));
const firstCard = page.locator('.rv-card').first();
check('authored title được escape và card có accessible name',
  (await firstCard.locator('h3').innerText()) === 'Mini <script> Test'
    && await firstCard.locator('script').count() === 0
    && await firstCard.getAttribute('aria-label') === 'Bắt đầu mini test Mini <script> Test');
const defaultFacts = (await page.locator('.rv-card').nth(1).locator('.rv-card__facts').innerText()).replace(/\s+/g, ' ');
check('default Mini Test là 1 đoạn và không bịa số câu/phút',
  (await page.locator('.rv-card').nth(1).locator('h3').innerText()) === 'Mini Test'
    && defaultFacts.includes('1 đoạn văn')
    && defaultFacts.includes('— câu hỏi')
    && defaultFacts.includes('— phút'));

await page.locator('#filter-module').selectOption('academic');
await academicStarted;
await page.locator('#clear-filters').click();
await page.getByText('Mini <script> Test', { exact: true }).waitFor({ state: 'visible' });
releaseAcademic();
await page.waitForTimeout(250);
check('response filter cũ không ghi đè response mới',
  await page.getByText('Kết quả cũ', { exact: true }).count() === 0);
check('Xóa lọc reset mô-đun và ẩn lại',
  await page.locator('#filter-module').inputValue() === ''
    && !(await page.locator('#clear-filters').isVisible()));
check('mọi request giữ limit=50 và test_type=mini',
  observedQueries.every((query) => query.limit === '50' && query.testType === 'mini'));

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
