// Browser-backed contract for the native `/listening/practice` behavior.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/listening/practice';
const fakeSession = JSON.stringify({
  access_token: 'listening-practice-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000038', email: 'listening-practice@local' },
});
const sectionItems = [{
  id: 'section-draft', test_id: 'PRACTICE-SECTION-1', title: 'Section <script>',
  trap: null, user_best_score: null, user_attempt_count: 2,
  user_submitted_attempt_count: 0,
}];
const trapItems = [{
  id: 'trap-a', title: 'Dates A', trap: 'Numbers & dates',
  user_best_score: 8, user_attempt_count: 2, user_submitted_attempt_count: 1,
}, {
  id: 'trap-b', title: 'Dates B', trap: 'Numbers & dates',
  user_best_score: 9, user_attempt_count: 1, user_submitted_attempt_count: 1,
}, {
  id: 'trap-c', title: 'Distractors', trap: 'Distractors',
  user_best_score: null, user_attempt_count: 0, user_submitted_attempt_count: 0,
}];
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
const observedGroups = [];
let scenario = 'malformed';
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/\/api\/listening\/overview(?:\?|$)/.test(url)) {
    if (scenario === 'overview-error') {
      return route.fulfill({
        status: 500, contentType: 'application/json', body: '{"detail":"secret-overview-detail"}',
      });
    }
    const body = scenario === 'malformed'
      ? { practice_groups: 'bad' }
      : { practice_groups: { trap: 3, section: 1, curated: 0 } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
  if (/\/api\/listening\/tests\?/.test(url)) {
    const parsed = new URL(url);
    const group = parsed.searchParams.get('practice_group');
    observedGroups.push({
      group,
      limit: parsed.searchParams.get('limit'),
      offset: parsed.searchParams.get('offset'),
      testType: parsed.searchParams.get('test_type'),
    });
    if (scenario === 'tab-error') {
      return route.fulfill({
        status: 500, contentType: 'application/json', body: '{"detail":"secret-tab-detail"}',
      });
    }
    const items = group === 'trap' ? trapItems : sectionItems;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items }) });
  }
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.locator('#state-empty').waitFor({ state: 'visible' });
check('overview lỗi hình dạng render empty state', await page.locator('#state-empty').isVisible());
check('empty state vẫn giữ navigation landmark', await page.locator('#practice-tabs').count() === 1);

scenario = 'valid';
await page.evaluate(() => { window.location.hash = 'section'; });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('[data-test-id="section-draft"]').waitFor({ state: 'visible' });
check('hash chọn đúng tab có dữ liệu',
  await page.getByRole('button', { name: /Mô phỏng section/ }).getAttribute('aria-pressed') === 'true'
    && new URL(page.url()).hash === '#section');
check('chỉ hiện tab có dữ liệu theo đúng overview count',
  await page.locator('.lp-tab').count() === 2
    && await page.getByRole('button', { name: /Bài soạn riêng/ }).count() === 0);
check('authored title được React escape',
  (await page.locator('[data-test-id="section-draft"] .lt-card-title').innerText()) === 'Section <script>'
    && await page.locator('.lt-card script').count() === 0);
check('attempt dang dở chưa bị coi là hoàn thành',
  await page.locator('[data-test-id="section-draft"]').getAttribute('data-status') === 'new'
    && (await page.locator('[data-test-id="section-draft"] .lt-card-stats').innerText()).includes('đã mở 2 lượt')
    && (await page.locator('[data-test-id="section-draft"] .lt-card-cta').innerText()) === 'Bắt đầu');
check('CTA giữ đúng lightweight runner destination',
  (await page.locator('[data-test-id="section-draft"] .lt-card-cta').getAttribute('href'))
    === '/pages/listening-practice-run.html?id=section-draft');

await page.getByRole('button', { name: /Theo bẫy/ }).click();
await page.locator('[data-test-id="trap-a"]').waitFor({ state: 'visible' });
check('đổi tab cập nhật hash và trạng thái a11y',
  new URL(page.url()).hash === '#trap'
    && await page.getByRole('button', { name: /Theo bẫy/ }).getAttribute('aria-pressed') === 'true');
check('nhóm bẫy nhiều bài đứng trước rồi mới theo tên',
  (await page.locator('.lp-group-title').first().innerText()).startsWith('Numbers & dates')
    && (await page.locator('.lp-group-title').first().innerText()).includes('2 bài'));
check('bài đã submitted dùng CTA Làm lại',
  await page.locator('[data-test-id="trap-a"]').getAttribute('data-status') === 'done'
    && (await page.locator('[data-test-id="trap-a"] .lt-card-cta').innerText()) === 'Làm lại');

await page.getByRole('button', { name: /Mô phỏng section/ }).click();
await page.locator('[data-test-id="section-draft"]').waitFor({ state: 'visible' });
check('quay lại tab dùng cache, không gọi request lần hai',
  observedGroups.filter((entry) => entry.group === 'section').length === 1);
check('mọi request giữ đúng practice paging contract',
  observedGroups.every((entry) => entry.testType === 'practice'
    && entry.limit === '100' && entry.offset === '0'));

scenario = 'tab-error';
await page.evaluate(() => { window.location.hash = 'trap'; });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#state-error').waitFor({ state: 'visible' });
check('lỗi tab dùng thông báo chung, không lộ chi tiết raw',
  !(await page.locator('#state-error').innerText()).includes('secret-tab-detail'));

scenario = 'overview-error';
await page.evaluate(() => { window.location.hash = ''; });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#state-error').waitFor({ state: 'visible' });
check('lỗi overview dùng thông báo chung, không lộ chi tiết raw',
  !(await page.locator('#state-error').innerText()).includes('secret-overview-detail'));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
