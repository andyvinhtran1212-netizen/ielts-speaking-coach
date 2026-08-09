// Browser-backed contract for the native `/reading/vocab` behavior.
//
// The source tests pin ownership and markup, but they cannot prove that React
// actually reconciles malformed payloads or ignores a response that completes
// after its filter request was superseded. This runner opens the production
// Next build used by G1, seeds a fake Supabase session and intercepts every API
// read. No request reaches the real backend and no secret is required.
//
//   node tooling/verify-reading-vocab-flow.mjs [base]
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/reading/vocab';

const fakeSession = JSON.stringify({
  access_token: 'reading-vocab-flow-not-a-real-token',
  refresh_token: 'x',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000030', email: 'reading-vocab@local' },
});

const initialPayload = {
  total: 3,
  items: [{
    id: 'p-initial',
    slug: 'initial-passage',
    title: 'Bài <script> mẫu',
    excerpt: 'Nội dung authored phải được React escape.',
    difficulty_level: 'intermediate',
    topic_tags: ['work', 'travel'],
    word_count: 420,
    estimated_minutes: 7,
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
    // CI installs Playwright's pinned browser. Local macOS machines may have a
    // newer package but an older cache (or a TLS-inspecting proxy that blocks
    // the download); using the installed Chrome keeps this verifier runnable
    // without weakening the CI path.
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
let releaseFoundation;
let foundationStartedResolve;
let foundationStarted = new Promise((resolve) => { foundationStartedResolve = resolve; });
let foundationRelease = new Promise((resolve) => { releaseFoundation = resolve; });
const observedQueries = [];

await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();

  if (/\/api\/reading\/vocab\?/.test(url)) {
    const parsed = new URL(url);
    const difficulty = parsed.searchParams.get('difficulty') || '';
    const tag = parsed.searchParams.get('tag') || '';
    observedQueries.push({ difficulty, tag, limit: parsed.searchParams.get('limit') });

    if (scenario === 'malformed') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 'not-a-number', items: [null, 'bad', { slug: '' }] }),
      });
    }

    if (difficulty === 'foundation') {
      foundationStartedResolve();
      await foundationRelease;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: 1,
          items: [{ id: 'old', slug: 'old', title: 'Kết quả cũ', difficulty_level: 'foundation' }],
        }),
      }).catch(() => {});
    }

    if (difficulty === 'advanced') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: 1,
          items: [{ id: 'new', slug: 'new', title: 'Kết quả mới', difficulty_level: 'advanced' }],
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(initialPayload),
    });
  }

  // The shared chrome may issue harmless reads. Return an empty object rather
  // than allowing any call to the real backend.
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) {
    return route.continue();
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

// 1. A malformed response is normalized into a truthful empty result.
await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.locator('#state-empty').waitFor({ state: 'visible' });
check('payload lỗi hình dạng render empty state, không làm vỡ trang',
  (await page.locator('#state-empty').innerText()).includes('Chưa có bài đọc'));
check('canonical total lỗi hình dạng rơi về số card hợp lệ',
  (await page.locator('#rv-total-count').innerText()).trim() === '0');
check('summary malformed vẫn nói đúng 0 bài',
  (await page.locator('#rv-result-count').innerText()).trim() === '0 bài đọc phù hợp');

// 2. A valid response preserves the redesign and canonical total > page size.
scenario = 'valid';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.rv-card').waitFor({ state: 'visible' });
check('API exact total khác số card được hiển thị rõ',
  (await page.locator('#rv-result-count').innerText()).trim()
    === '3 bài đọc phù hợp · đang hiển thị 1');
check('hero dùng cùng canonical total',
  (await page.locator('#rv-total-count').innerText()).trim() === '3');
check('card redesign có top, footer và CTA',
  await page.locator('.rv-card__top').count() === 1
    && await page.locator('.rv-card__footer').count() === 1
    && (await page.locator('.rv-card__cta').innerText()).includes('Đọc & tra từ'));
check('authored title được escape, không tạo script node',
  (await page.locator('.rv-card h3').innerText()) === 'Bài <script> mẫu'
    && await page.locator('.rv-card script').count() === 0);
check('card có accessible name theo nội dung thật',
  await page.locator('.rv-card').getAttribute('aria-label') === 'Đọc bài Bài <script> mẫu');

// 3. A superseded slow request must never repaint over the newest filter.
await page.locator('#filter-difficulty').selectOption('foundation');
await foundationStarted;
await page.locator('#filter-difficulty').selectOption('advanced');
await page.getByText('Kết quả mới', { exact: true }).waitFor({ state: 'visible' });
releaseFoundation();
await page.waitForTimeout(250);
check('response filter cũ không ghi đè response mới',
  await page.getByText('Kết quả mới', { exact: true }).count() === 1
    && await page.getByText('Kết quả cũ', { exact: true }).count() === 0);
check('mỗi request giữ limit=50 và đúng filter',
  observedQueries.every((query) => query.limit === '50')
    && observedQueries.some((query) => query.difficulty === 'foundation')
    && observedQueries.some((query) => query.difficulty === 'advanced'));

// 4. The clear action restores the unfiltered result and hides itself.
await page.locator('#filter-tag').selectOption('travel');
await page.getByText('Kết quả mới', { exact: true }).waitFor({ state: 'visible' });
check('nút Xóa lọc chỉ hiện khi có filter', await page.locator('#clear-filters').isVisible());
await page.locator('#clear-filters').click();
await page.getByText('Bài <script> mẫu', { exact: true }).waitFor({ state: 'visible' });
check('Xóa lọc reset cả hai select',
  await page.locator('#filter-difficulty').inputValue() === ''
    && await page.locator('#filter-tag').inputValue() === '');
check('nút Xóa lọc ẩn lại sau reset', !(await page.locator('#clear-filters').isVisible()));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
