// Browser-backed contract for the native `/listening/browse` behavior.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/listening/browse';
const fakeSession = JSON.stringify({
  access_token: 'listening-browse-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000040', email: 'listening-browse@local' },
});
const items = [{
  id: 'content-one', title: 'Travel <script>', description: 'Airport & hotel',
  accent_tag: 'uk_rp', cefr_level: 'B2', ielts_section: 1,
  audio_duration_seconds: 89, available_modes: ['mcq', 'dictation', 'unknown'],
}, {
  id: 'content-empty', title: 'No exercises', description: '',
  audio_duration_seconds: 0, available_modes: [],
}, {
  id: 'content-unreadable', title: 'Lookup failed', description: '',
  available_modes: 'dictation',
}];
const fullPage = Array.from({ length: 100 }, (_, index) => ({
  id: `paged-${index}`,
  title: `Paged item ${index}`,
  description: '',
  ielts_section: 4,
  available_modes: [],
}));
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
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/\/api\/listening\/content\?/.test(url)) {
    const parsed = new URL(url);
    const query = {
      accent: parsed.searchParams.get('accent_tag'),
      cefr: parsed.searchParams.get('cefr_level'),
      section: parsed.searchParams.get('ielts_section'),
      limit: parsed.searchParams.get('limit'),
      offset: parsed.searchParams.get('offset'),
    };
    observedQueries.push(query);
    if (query.accent === 'ca') {
      return route.fulfill({
        status: 500, contentType: 'application/json', body: '{"detail":"secret-browse-detail"}',
      });
    }
    const pageItems = query.section === '4'
      ? (query.offset === '0' ? fullPage : [{
          id: 'paged-final', title: 'Final paged item', description: '',
          ielts_section: 4, available_modes: [],
        }])
      : query.cefr === 'C2' ? [] : items;
    const body = { items: pageItems };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.locator('[data-content-id="content-one"]').waitFor({ state: 'visible' });
check('render đủ payload hợp lệ', await page.locator('.content-card').count() === 3);
check('authored metadata được React escape',
  (await page.locator('[data-content-id="content-one"] h3').innerText()) === 'Travel <script>'
    && (await page.locator('[data-content-id="content-one"] .desc').innerText()) === 'Airport & hotel'
    && await page.locator('.content-card script').count() === 0);
check('metadata pills giữ accent, CEFR, section và duration',
  (await page.locator('[data-content-id="content-one"] .meta-row').innerText()).includes('uk_rp')
    && (await page.locator('[data-content-id="content-one"] .meta-row').innerText()).includes('B2')
    && (await page.locator('[data-content-id="content-one"] .meta-row').innerText()).includes('Section 1')
    && (await page.locator('[data-content-id="content-one"] .meta-row').innerText()).includes('1p'));
const modeLinks = page.locator('[data-content-id="content-one"] .mode-link');
check('chỉ render mode được backend báo theo thứ tự sư phạm',
  await modeLinks.count() === 2
    && (await modeLinks.nth(0).innerText()) === 'Chép chính tả'
    && (await modeLinks.nth(1).innerText()) === 'Trắc nghiệm');
check('mode links encode đúng content id',
  (await modeLinks.nth(0).getAttribute('href'))
    === '/pages/listening-dictation.html?content_id=content-one'
    && (await modeLinks.nth(1).getAttribute('href'))
    === '/pages/listening-mcq.html?content_id=content-one');
check('empty array là no-mode thật',
  (await page.locator('[data-content-id="content-empty"] .mode-empty').innerText())
    .includes('Chưa có dạng luyện nào'));
check('missing hoặc malformed modes là lookup failure, không giả no-data',
  (await page.locator('[data-content-id="content-unreadable"] .mode-empty').innerText())
    .includes('Không đọc được'));
check('request đầu dùng paging contract không kèm filter rỗng',
  observedQueries[0]?.limit === '100' && observedQueries[0]?.offset === '0'
    && observedQueries[0]?.accent === null && observedQueries[0]?.cefr === null
    && observedQueries[0]?.section === null);

await page.locator('#filter-accent').selectOption('us_general');
await page.locator('[data-content-id="content-one"]').waitFor({ state: 'visible' });
check('đổi accent gửi đúng canonical query',
  observedQueries.some((query) => query.accent === 'us_general'));

await page.locator('#filter-section').selectOption('4');
await page.locator('[data-content-id="paged-final"]').waitFor({ state: 'visible' });
check('trang đủ 100 mục tiếp tục tải offset 100 và ghép kết quả',
  await page.locator('.content-card').count() === 101
    && observedQueries.some((query) => query.section === '4' && query.offset === '100'));
await page.locator('#filter-section').selectOption('');
await page.locator('[data-content-id="content-one"]').waitFor({ state: 'visible' });

await page.locator('#filter-cefr').selectOption('C2');
await page.locator('#state-empty').waitFor({ state: 'visible' });
check('kết quả lọc rỗng có empty state riêng',
  (await page.locator('#state-empty').innerText()).includes('khớp bộ lọc'));

await page.locator('#filter-cefr').selectOption('');
await page.locator('#filter-accent').selectOption('ca');
await page.locator('#state-error').waitFor({ state: 'visible' });
check('lỗi backend dùng thông báo chung, không lộ raw detail',
  !(await page.locator('#state-error').innerText()).includes('secret-browse-detail'));
check('mọi request đều giữ limit/offset contract',
  observedQueries.every((query) => query.limit === '100'
    && (query.offset === '0' || (query.section === '4' && query.offset === '100'))));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
