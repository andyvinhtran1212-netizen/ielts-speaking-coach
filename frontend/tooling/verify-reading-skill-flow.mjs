// Browser-backed contract for the native `/reading/skill` behavior.
//
// The production Next build runs against a fake Supabase session and a fully
// intercepted backend. This proves request ordering and visible behavior
// without a secret or any write to real data.
//
//   node tooling/verify-reading-skill-flow.mjs [base]
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/reading/skill';

const fakeSession = JSON.stringify({
  access_token: 'reading-skill-flow-not-a-real-token',
  refresh_token: 'x',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000031', email: 'reading-skill@local' },
});

const initialPayload = {
  total: 4,
  items: [{
    id: 'skill-initial',
    slug: 'skimming-sample',
    title: 'Skimming — Bài <script> mẫu',
    excerpt: 'Nội dung authored phải được React escape.',
    difficulty_level: 'intermediate',
    topic_tags: ['work'],
    skill_focus: 'skimming',
    estimated_minutes: 8,
  }, {
    id: 'skill-inference',
    slug: 'inference-sample',
    title: 'Inference · Tìm hàm ý',
    excerpt: 'Luyện đọc điều tác giả không nói trực tiếp.',
    difficulty_level: 'advanced',
    topic_tags: ['science'],
    skill_focus: 'inference',
    estimated_minutes: 10,
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
let releaseFoundation;
let foundationStartedResolve;
let foundationStarted = new Promise((resolve) => { foundationStartedResolve = resolve; });
let foundationRelease = new Promise((resolve) => { releaseFoundation = resolve; });
const observedQueries = [];

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();

  if (/\/api\/reading\/skill\?/.test(url)) {
    const parsed = new URL(url);
    const difficulty = parsed.searchParams.get('difficulty') || '';
    const skill = parsed.searchParams.get('skill') || '';
    observedQueries.push({ difficulty, skill, limit: parsed.searchParams.get('limit') });

    if (scenario === 'malformed') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 'bad', items: [null, 'bad', { slug: '' }] }),
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
          items: [{
            id: 'old', slug: 'old', title: 'Skimming — Kết quả cũ',
            difficulty_level: 'foundation', skill_focus: 'skimming',
          }],
        }),
      }).catch(() => {});
    }

    if (difficulty === 'advanced') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: 1,
          items: [{
            id: 'new', slug: 'new', title: 'Inference — Kết quả mới',
            difficulty_level: 'advanced', skill_focus: 'inference',
          }],
        }),
      });
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

// 1. Malformed data is normalized into a truthful empty result.
await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.locator('#state-empty').waitFor({ state: 'visible' });
check('payload lỗi hình dạng render empty state, không làm vỡ trang',
  (await page.locator('#state-empty').innerText()).includes('Chưa có bài luyện'));
check('canonical total lỗi hình dạng rơi về số card hợp lệ',
  (await page.locator('#rv-total-count').innerText()).trim() === '0');
check('focus count malformed vẫn đúng 0 nhóm',
  (await page.locator('#rv-focus-count').innerText()).trim() === '0');
check('summary malformed vẫn nói đúng 0 bài và 0 nhóm',
  (await page.locator('#rv-result-count').innerText()).trim() === '0 bài luyện · 0 nhóm kỹ năng');

// 2. Valid data preserves canonical totals, authored content and rich cards.
scenario = 'valid';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.rv-card').first().waitFor({ state: 'visible' });
check('API exact total khác số card được hiển thị rõ',
  (await page.locator('#rv-result-count').innerText()).trim()
    === '4 bài luyện · đang hiển thị 2 bài thuộc 2 nhóm kỹ năng');
check('hero dùng cùng canonical total và focus count',
  (await page.locator('#rv-total-count').innerText()).trim() === '4'
    && (await page.locator('#rv-focus-count').innerText()).trim() === '2');
check('card redesign có top, footer và CTA',
  await page.locator('.rv-card__top').count() === 2
    && await page.locator('.rv-card__footer').count() === 2
    && (await page.locator('.rv-card__cta').first().innerText()).includes('Luyện ngay'));
const firstCard = page.locator('.rv-card').first();
check('title hiển thị được rút gọn nhưng vẫn giữ full title',
  (await firstCard.locator('h3').innerText()) === 'Bài <script> mẫu'
    && await firstCard.locator('h3').getAttribute('title') === 'Skimming — Bài <script> mẫu');
check('authored title được escape, không tạo script node',
  await firstCard.locator('script').count() === 0);
check('card có accessible name theo nội dung hiển thị',
  await firstCard.getAttribute('aria-label') === 'Luyện bài Bài <script> mẫu');

// 3. A superseded slow request cannot repaint over the newest filter.
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

// 4. Clear restores both filters and the unfiltered response.
await page.locator('#filter-skill').selectOption('inference');
await page.getByText('Kết quả mới', { exact: true }).waitFor({ state: 'visible' });
check('nút Xóa lọc chỉ hiện khi có filter', await page.locator('#clear-filters').isVisible());
await page.locator('#clear-filters').click();
await page.getByText('Bài <script> mẫu', { exact: true }).waitFor({ state: 'visible' });
check('Xóa lọc reset cả hai select',
  await page.locator('#filter-difficulty').inputValue() === ''
    && await page.locator('#filter-skill').inputValue() === '');
check('nút Xóa lọc ẩn lại sau reset', !(await page.locator('#clear-filters').isVisible()));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
