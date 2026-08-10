// Browser-backed contract for the native `/listening/analytics` behavior.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/listening/analytics';
const fakeSession = JSON.stringify({
  access_token: 'listening-analytics-flow-not-a-real-token', refresh_token: 'x',
  token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000041', email: 'listening-analytics@local' },
});
const days = Array.from({ length: 14 }, (_, index) => ({
  date: `2026-07-${String(index + 1).padStart(2, '0')}`,
  count: index === 13 ? 7 : index % 3,
  avg_score: index === 13 ? 0.75 : null,
}));
const validPayload = {
  total_attempts: 7,
  by_mode: {
    mini: { count: 2, scored_count: 2, attempts_count: 3, avg_score: 0.75, completion: 0.6667 },
    drill: { count: 3, scored_count: 3, attempts_count: 3, avg_score: 0.5, completion: 1 },
    full: { count: 0, scored_count: 0, attempts_count: 0, avg_score: null, completion: null },
    practice: { count: 1, scored_count: 1, attempts_count: 1, avg_score: 1, completion: 1 },
  },
  by_day: days,
  recent_attempts: [
    { id: 'recent-one', type: 'mini', title: 'Lesson <script>', created_at: '2026-07-14T10:00:00Z', accuracy: 0.8, status: 'submitted' },
    { id: 'recent-two', type: 'drill', title: '', created_at: '2026-07-13T10:00:00Z', accuracy: null, status: 'abandoned' },
    { id: 'recent-three', type: 'full', title: '', created_at: '2026-07-12T10:00:00Z', accuracy: null, status: 'in_progress' },
    { id: 'recent-four', type: 'practice', title: '', created_at: '2026-07-11T10:00:00Z', accuracy: 1, status: 'submitted' },
  ],
  weakest_mode: 'drill',
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
const observedRanges = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/\/api\/listening\/analytics\?/.test(url)) {
    const range = new URL(url).searchParams.get('range');
    observedRanges.push(range);
    if (range === 'all') {
      return route.fulfill({
        status: 500, contentType: 'application/json', body: '{"detail":"secret-analytics-detail"}',
      });
    }
    const body = range === '7d'
      ? { total_attempts: 0, by_mode: {}, by_day: [], recent_attempts: [], weakest_mode: null }
      : validPayload;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.locator('#analytics-surface').waitFor({ state: 'visible' });
check('request mặc định dùng range=30d', observedRanges[0] === '30d');
check('tổng lượt lấy từ canonical payload', (await page.locator('#stat-total').innerText()) === '7');
check('điểm tổng weight theo scored_count', (await page.locator('#stat-avg').innerText()) === '67%'
  && (await page.locator('#stat-avg-sub').innerText()) === 'trong 6 bài đã nộp');
check('hoàn thành tổng weight theo attempts_count', (await page.locator('#stat-acc').innerText()) === '86%');
check('weakest mode do backend quyết định', (await page.locator('#weakest-banner').innerText()).includes('Luyện kỹ năng (drill)'));
check('bảng giữ đủ bốn mode theo thứ tự canonical',
  await page.locator('#mode-table-body tr').count() === 4
    && (await page.locator('#mode-table-body tr').evaluateAll((rows) => rows.map((row) => row.dataset.mode).join(',')))
      === 'mini,drill,full,practice');
check('biểu đồ giữ đủ 14 ngày và metadata điểm',
  await page.locator('#day-chart .day-bar').count() === 14
    && await page.locator('#day-labels > div').count() === 14
    && (await page.locator('#day-chart .day-bar').last().getAttribute('title'))?.includes('TB 75%'));
const recentScores = await page.locator('#recent-list .recent-score').allInnerTexts();
check('recent phân biệt điểm, bỏ dở, đang làm và perfect',
  recentScores.join(',') === '80%,bỏ dở,đang làm,100%'
    && await page.locator('#recent-list .recent-score.is-perfect').count() === 1);
check('authored title được React escape',
  (await page.locator('#recent-list .recent-mode').first().innerText()) === 'Lesson <script>'
    && await page.locator('#recent-list script').count() === 0);

await page.locator('[data-range="7d"]').click();
await page.locator('#state-empty').waitFor({ state: 'visible' });
check('range=7d có empty state riêng', observedRanges.includes('7d')
  && (await page.locator('#state-empty').innerText()).includes('Chưa có dữ liệu'));
check('range toggle phản ánh lựa chọn bằng aria-pressed',
  await page.locator('[data-range="7d"]').getAttribute('aria-pressed') === 'true'
    && await page.locator('[data-range="30d"]').getAttribute('aria-pressed') === 'false');

await page.locator('[data-range="all"]').click();
await page.locator('#state-error').waitFor({ state: 'visible' });
check('range=all dùng đúng query', observedRanges.includes('all'));
check('lỗi backend dùng thông báo chung, không lộ raw detail',
  !(await page.locator('#state-error').innerText()).includes('secret-analytics-detail')
    && (await page.locator('#state-error').innerText()).includes('Vui lòng thử lại'));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
