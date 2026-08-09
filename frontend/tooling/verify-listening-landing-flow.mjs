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
      : scenario === 'no-modes'
        ? { tests: {}, content: 5, exercise_modes: {} }
        : validOverview;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.locator('#exam-empty').waitFor({ state: 'visible' });
check('payload lỗi hình dạng trở thành empty state trung thực',
  await page.locator('#exam-empty').isVisible()
    && await page.locator('[data-mode="full-test"]').count() === 0);
check('content không đúng kiểu số không mở library',
  await page.locator('#section-library').count() === 0);
check('analytics luôn còn lối vào', await page.locator('[data-mode="analytics"]').isVisible());

scenario = 'valid';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('[data-mode="full-test"]').waitFor({ state: 'visible' });
check('chỉ render exam cards có count dương',
  await page.locator('[data-mode="full-test"]').count() === 1
    && await page.locator('[data-mode="mini-test"]').count() === 0
    && await page.locator('[data-mode="skills-practice"]').count() === 1
    && await page.locator('[data-mode="practice"]').count() === 1);
check('badge phản ánh đúng canonical overview counts',
  (await page.locator('[data-mode="full-test"] .mode-card__badge').textContent())?.trim() === '2 bài'
    && (await page.locator('[data-mode="skills-practice"] .mode-card__badge').textContent())?.trim() === '4 bài'
    && (await page.locator('[data-mode="practice"] .mode-card__badge').textContent())?.trim() === '3 bài');
check('library chỉ mở khi có content và runnable mode',
  await page.locator('#section-library').isVisible()
    && (await page.locator('[data-mode="browse"] .mode-card__badge').textContent())?.trim() === '5 bài');
const browseLede = await page.locator('[data-mode="browse"] .lede').innerText();
check('mode labels dùng allowlist đúng thứ tự, bỏ mini_test và unknown',
  browseLede.includes('Chép chính tả · Trắc nghiệm')
    && !browseLede.includes('mini_test') && !browseLede.includes('unknown'));
check('mọi card giữ đúng destination',
  (await page.locator('[data-mode="full-test"]').getAttribute('href')) === '/listening/tests'
    && (await page.locator('[data-mode="skills-practice"]').getAttribute('href')) === '/listening/skills'
    && (await page.locator('[data-mode="practice"]').getAttribute('href')) === '/listening/practice'
    && (await page.locator('[data-mode="browse"]').getAttribute('href')) === '/listening/browse'
    && (await page.locator('[data-mode="analytics"]').getAttribute('href')) === '/listening/analytics');

scenario = 'no-modes';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#exam-empty').waitFor({ state: 'visible' });
check('content rows đơn lẻ không tạo dead-end library card',
  await page.locator('#section-library').count() === 0);

scenario = 'error';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#landing-error').waitFor({ state: 'visible' });
check('API lỗi vẫn mở bốn thư viện đề mà không bịa count',
  await page.locator('[data-mode="full-test"]').count() === 1
    && await page.locator('[data-mode="mini-test"]').count() === 1
    && await page.locator('[data-mode="skills-practice"]').count() === 1
    && await page.locator('[data-mode="practice"]').count() === 1
    && await page.locator('.mode-card__badge').count() === 0);
check('API lỗi không mở content library chưa xác minh',
  await page.locator('#section-library').count() === 0);
check('thông báo lỗi chung không lộ chi tiết backend',
  !(await page.locator('#landing-error').innerText()).includes('secret-listening-detail'));
check('request dùng đúng canonical overview endpoint',
  overviewRequests.length === 4
    && overviewRequests.every((url) => new URL(url).pathname === '/api/listening/overview'));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
