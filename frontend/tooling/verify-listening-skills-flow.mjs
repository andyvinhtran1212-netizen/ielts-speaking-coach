// Browser-backed contract for the native `/listening/skills` behavior.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/listening/skills';
const fakeSession = JSON.stringify({
  access_token: 'listening-skills-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000037', email: 'listening-skills@local' },
});
const payload = {
  items: [{
    id: 'form-draft', test_id: 'FORM-L2-T2', title: 'FORM L2 — Names <script>',
    drill_type: 'form', level: 'L2', task: 'T2', user_best_score: null,
    user_attempt_count: 2, user_submitted_attempt_count: 0,
  }, {
    id: 'form-done', test_id: 'FORM-L1-T1', title: 'FORM L1 — Addresses',
    drill_type: 'form', level: 'L1', task: 'T1', user_best_score: 4,
    user_attempt_count: 3, user_submitted_attempt_count: 1,
  }, {
    id: 'note-done', test_id: 'NOTE-L1-T1', title: 'NOTE L1 · Campus tour',
    drill_type: 'note', level: 'L1', task: 'T1', user_best_score: 5,
    user_attempt_count: 1, user_submitted_attempt_count: 1,
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
        status: 500, contentType: 'application/json', body: '{"detail":"secret-skills-detail"}',
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
  (await page.locator('#ls-total-count').innerText()).trim() === '0'
    && (await page.locator('#ls-done-count').innerText()).trim() === '0'
    && (await page.locator('#ls-type-count').innerText()).trim() === '0');

scenario = 'valid';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.ls-drill').first().waitFor({ state: 'visible' });
check('summary tính đúng submitted attempt và số dạng',
  (await page.locator('#ls-total-count').innerText()).trim() === '3'
    && (await page.locator('#ls-done-count').innerText()).trim() === '2'
    && (await page.locator('#ls-type-count').innerText()).trim() === '2');
check('tự chọn dạng đầu tiên còn bài chưa nộp',
  await page.getByRole('button', { name: /Điền vào form/ }).getAttribute('aria-pressed') === 'true');
check('nav giữ đủ 11 dạng và khóa dạng chưa có bài',
  await page.locator('.ls-skill-nav__button').count() === 11
    && await page.getByRole('button', { name: /Điền bảng/ }).isDisabled());
check('ladder sắp L1/T1 trước L2/T2',
  await page.locator('.ls-drill').first().getAttribute('data-test-id') === 'form-done');
check('title được rút gọn và React escape authored content',
  (await page.locator('[data-test-id="form-draft"] .ls-drill-title').innerText()) === 'Names <script>'
    && await page.locator('.ls-drill script').count() === 0);
check('attempt dang dở vẫn thuộc nhóm Chưa làm',
  await page.locator('[data-test-id="form-draft"]').getAttribute('data-status') === 'new'
    && (await page.locator('[data-test-id="form-draft"] .ls-drill-status').innerText()) === 'Chưa làm');
check('card giữ đúng player và dictation destination',
  (await page.locator('[data-test-id="form-draft"] .ls-drill-cta').first().getAttribute('href'))
      === '/core-player/launch?surface=listening_test&id=form-draft'
    && (await page.locator('[data-test-id="form-draft"] .ls-drill-cta').nth(1).getAttribute('href'))
      === '/core-player/launch?surface=listening_dictation&test_id=form-draft');

await page.getByRole('button', { name: 'Đã luyện', exact: true }).click();
check('lọc Đã luyện chỉ giữ attempt đã submitted',
  await page.locator('.ls-drill').count() === 1
    && await page.locator('[data-test-id="form-done"]').isVisible());
await page.getByRole('button', { name: 'Chưa làm', exact: true }).click();
check('lọc Chưa làm giữ attempt chưa nộp',
  await page.locator('.ls-drill').count() === 1
    && await page.locator('[data-test-id="form-draft"]').isVisible());
await page.getByRole('button', { name: /Điền ghi chú/ }).click();
check('đổi dạng cập nhật danh sách và live count',
  (await page.locator('#ls-visible-count').innerText()).includes('0/1 bài · Điền ghi chú')
    && (await page.locator('.ls-filter-empty').innerText()).includes('Không có bài'));
check('request dùng đúng drill paging contract',
  observedQueries.every((query) => query.limit === '100'
    && query.offset === '0' && query.testType === 'drill'));

scenario = 'error';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#state-error').waitFor({ state: 'visible' });
check('lỗi backend dùng thông báo chung, không lộ chi tiết raw',
  !(await page.locator('#state-error').innerText()).includes('secret-skills-detail'));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
