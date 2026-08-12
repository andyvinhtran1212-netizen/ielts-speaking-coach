// Browser-backed read-flow contract for the native `/admin` dashboard.
// Every backend call is intercepted; the runner proves admin gating, three
// canonical reads, stale-response suppression, refresh, React escaping and
// responsive containment without touching production data.
//
//   node tooling/verify-admin-overview-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/admin';
const fakeSession = JSON.stringify({
  access_token: 'admin-overview-flow-not-a-real-token',
  refresh_token: 'x',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: '00000000-0000-0000-0000-000000000093', email: 'admin-overview@local' },
});

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

const overviewPayload = {
  students: { total: 13, active_7d: 8, active_30d: 11 },
  errors: { undismissed: 4, last_24h: 2 },
  access_codes: { active: 9, by_type: { mass: 4, direct: 3, staff: 2 } },
  skills: {
    speaking: { sessions_7d: 6, sessions_total: 60, avg_band_7d: 6.5 },
    writing: { essays_7d: 5, essays_total: 50, feedback_pending: 2 },
    listening: { attempts_7d: 7, attempts_total: 70, avg_score_7d: 0.75, dictation_7d: 3 },
    vocab: { due_review_today: 12, words_total: 120 },
    grammar: { articles_viewed_7d: 15 },
  },
  recent_activity: [
    {
      timestamp: '2026-08-12T01:02:03Z',
      user_email: '<img src=x onerror=alert(1)>',
      skill: 'writing',
      action: '<script>authored</script>',
      score: null,
      link: 'javascript:alert(1)',
    },
    {
      timestamp: '2026-08-11T01:02:03Z',
      user_email: 'student@example.com',
      skill: 'speaking',
      action: 'Hoàn thành buổi Speaking',
      score: 6.5,
      link: '/pages/result.html?session_id=fixture',
    },
  ],
  generated_at: '2026-08-12T01:02:03Z',
};

const opsPayload = (days) => ({
  total_users: 100,
  active_codes: 44,
  distinct_visitors: { count: days * 10, authenticated: days * 4, anonymous: days * 6, window_days: days },
  total_practices: 123,
  grading_minutes: 456.7,
  tokens_called: { count: days * 1000, window_days: days },
  attention: { errors_undismissed: 4, writing_pending: 2 },
  computed_at: '2026-08-12T01:02:03Z',
});

const trendsPayload = (days) => ({
  days,
  series: {
    visitors: Array.from({ length: days }, (_, index) => ({ value: index + 1 })),
    practices: Array.from({ length: days }, (_, index) => ({ value: (index % 5) + 1 })),
    tokens: Array.from({ length: days }, (_, index) => ({ value: (index + 1) * 100 })),
  },
});

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(([key, value]) => {
  try { localStorage.setItem(key, value); } catch (_) {}
}, [storageKey(SB), fakeSession]);

const page = await context.newPage();
const pageErrors = [];
const requests = [];
const unexpectedWrites = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

let releaseSeven;
let sevenStartedResolve;
const sevenStarted = new Promise((resolve) => { sevenStartedResolve = resolve; });
const sevenRelease = new Promise((resolve) => { releaseSeven = resolve; });
let holdThirtyTrends = false;
let thirtyTrendsStartedResolve;
const thirtyTrendsStarted = new Promise((resolve) => { thirtyTrendsStartedResolve = resolve; });
const neverResolve = new Promise(() => {});

await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  const method = request.method();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();

  const parsed = new URL(url);
  requests.push({ method, path: parsed.pathname, search: parsed.search });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !['/api/analytics/events', '/api/error-logs'].includes(parsed.pathname)) {
    unexpectedWrites.push(`${method} ${parsed.pathname}`);
  }

  if (parsed.pathname === '/auth/me') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000093', email: 'admin-overview@local', role: 'admin' }) });
  }
  if (parsed.pathname === '/admin/overview') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overviewPayload) });
  }
  if (parsed.pathname === '/admin/ai-usage') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        overall: { calls: 1, cost_usd: 0.01, by_service: { claude: { calls: 1, cost_usd: 0.01 } } },
        per_user: [],
        meta: { query_limit: 10000, returned_rows: 1, total_matching_rows: 1, truncated: false },
      }),
    });
  }
  if (parsed.pathname === '/admin/dashboard/overview') {
    const days = Number(parsed.searchParams.get('visitors_window')) || 30;
    if (days === 7) {
      sevenStartedResolve();
      await sevenRelease;
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opsPayload(days)) }).catch(() => {});
  }
  if (parsed.pathname === '/admin/dashboard/trends') {
    const days = Number(parsed.searchParams.get('days')) || 30;
    if (days === 30 && holdThirtyTrends) {
      thirtyTrendsStartedResolve();
      await neverResolve;
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(trendsPayload(days)) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
try {
  await page.locator('.db-card__label').filter({ hasText: /Tổng người dùng/i }).waitFor({ state: 'visible' });
} catch (error) {
  console.error('  URL khi dashboard không sẵn sàng:', page.url());
  console.error('  Nội dung hiện tại:', (await page.locator('body').innerText().catch(() => '')).slice(0, 800));
  console.error('  Lỗi JS:', pageErrors.join(' | '));
  throw error;
}
await page.getByText('100', { exact: true }).first().waitFor({ state: 'visible' });

check('backend-owned admin gate được gọi trước khi hiện dashboard',
  requests.some((request) => request.method === 'GET' && request.path === '/auth/me'));
check('mặc định gọi đủ ba endpoint với cửa sổ 30 ngày',
  requests.some((request) => request.path === '/admin/dashboard/overview' && request.search === '?visitors_window=30')
    && requests.some((request) => request.path === '/admin/dashboard/trends' && request.search === '?days=30')
    && requests.some((request) => request.path === '/admin/overview'));
check('KPI và attention dùng đúng canonical payload',
  await page.getByText('44', { exact: true }).count() >= 1
    && await page.getByText('300', { exact: true }).count() >= 1
    && await page.getByText('4', { exact: true }).count() >= 1);
check('tab Nội dung thật sự ẩn ở trạng thái đầu', !(await page.locator('#pane-content').isVisible()));

await page.getByRole('tab', { name: 'Vận hành' }).focus();
await page.keyboard.press('ArrowRight');
await page.getByText('<script>authored</script>', { exact: false }).waitFor({ state: 'visible' });
check('phím mũi tên đổi tab, chuyển focus và chỉ hiện Nội dung',
  !(await page.locator('#pane-ops').isVisible())
    && await page.locator('#pane-content').isVisible()
    && await page.getByRole('tab', { name: 'Nội dung' }).evaluate((element) => element === document.activeElement));
check('authored activity được React escape, không tạo script/img node',
  await page.locator('.activity-feed script, .activity-feed img').count() === 0);
check('link không an toàn bị hạ thành row tĩnh',
  await page.locator('.activity-row.is-static').count() === 1
    && await page.locator('.activity-row[href^="javascript:"]').count() === 0);
check('đường dẫn nội bộ hợp lệ vẫn là link',
  await page.locator('a.activity-row[href="/pages/result.html?session_id=fixture"]').count() === 1);
check('Listening hiển thị đúng tỷ lệ từ canonical payload',
  await page.getByText('75%', { exact: true }).count() === 1);

await page.getByRole('tab', { name: 'Vận hành' }).click();
const contentReadsBeforeWindowChange = requests.filter((request) => request.path === '/admin/overview').length;
await page.locator('#db-window').selectOption('7');
await sevenStarted;
check('drill-down token mang đúng cửa sổ 7 ngày',
  await page.locator('.db-card').filter({ hasText: 'Token đã gọi' }).first().locator('.db-card__link').getAttribute('href') === '/admin/system/ai-usage?days=7');
await page.locator('#db-window').selectOption('90');
await page.getByText('900', { exact: true }).waitFor({ state: 'visible' });
releaseSeven();
await page.waitForTimeout(250);
check('response 7 ngày đến trễ không ghi đè lựa chọn 90 ngày',
  await page.locator('#db-window').inputValue() === '90'
    && await page.getByText('900', { exact: true }).count() >= 1
    && await page.locator('#pane-ops').getByText('70', { exact: true }).count() === 0);
check('drill-down token mang đúng cửa sổ 90 ngày',
  await page.locator('.db-card').filter({ hasText: 'Token đã gọi' }).first().locator('.db-card__link').getAttribute('href') === '/admin/system/ai-usage?days=90');
check('đổi cửa sổ không gọi thừa aggregate Nội dung',
  requests.filter((request) => request.path === '/admin/overview').length === contentReadsBeforeWindowChange);

holdThirtyTrends = true;
await page.locator('#db-window').selectOption('30');
await thirtyTrendsStarted;
await page.getByText('300', { exact: true }).waitFor({ state: 'visible' });
check('trends treo không chặn KPI canonical hiển thị',
  await page.locator('#db-window').inputValue() === '30'
    && await page.getByText('300', { exact: true }).count() >= 1
    && await page.locator('.db-trends').getAttribute('aria-busy') === 'true');
const visitorsCard = page.locator('.db-card').filter({ hasText: 'Người xem' }).first();
const tokensCard = page.locator('.db-card').filter({ hasText: 'Token đã gọi' }).first();
check('KPI hiện ngay nhưng phần series vẫn báo đang tải',
  await visitorsCard.getAttribute('aria-busy') === 'true'
    && await tokensCard.getAttribute('aria-busy') === 'true'
    && await visitorsCard.evaluate((element) => element.classList.contains('is-series-loading') && !element.classList.contains('is-loading'))
    && await tokensCard.evaluate((element) => element.classList.contains('is-series-loading') && !element.classList.contains('is-loading')));

overviewPayload.skills.listening.avg_score_7d = null;
const beforeRefresh = requests.length;
await page.getByRole('button', { name: /Tải lại/ }).click();
await page.getByRole('button', { name: /Tải lại/ }).waitFor({ state: 'visible' });
await page.waitForFunction(() => {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('Tải lại'));
  return button && !button.disabled;
});
const refreshRequests = requests.slice(beforeRefresh).filter((request) => request.path.startsWith('/admin/'));
check('một lần Tải lại gọi lại đủ ba endpoint',
  refreshRequests.some((request) => request.path === '/admin/dashboard/overview')
    && refreshRequests.some((request) => request.path === '/admin/dashboard/trends')
    && refreshRequests.some((request) => request.path === '/admin/overview'));
await page.getByRole('tab', { name: 'Nội dung' }).click();
check('Listening thiếu tỷ lệ hiển thị dấu gạch, không bịa 0%',
  await page.locator('.admin-hub-card[data-skill="listening"] .stat-num').nth(2).textContent() === '—');

const desktopGeometry = await page.evaluate(() => ({
  client: document.documentElement.clientWidth,
  scroll: document.documentElement.scrollWidth,
  shellRight: document.querySelector('.overview-shell')?.getBoundingClientRect().right || 0,
}));
check('desktop không tràn ngang', desktopGeometry.scroll === desktopGeometry.client && desktopGeometry.shellRight <= desktopGeometry.client);
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(100);
const mobileGeometry = await page.evaluate(() => ({
  client: document.documentElement.clientWidth,
  scroll: document.documentElement.scrollWidth,
  shellRight: document.querySelector('.overview-shell')?.getBoundingClientRect().right || 0,
}));
check('mobile không tràn ngang', mobileGeometry.scroll === mobileGeometry.client && mobileGeometry.shellRight <= mobileGeometry.client);
check('dashboard không phát mutation nghiệp vụ', unexpectedWrites.length === 0, unexpectedWrites.join(', '));

await page.getByRole('tab', { name: 'Vận hành' }).click();
await page.locator('.db-card').filter({ hasText: 'Token đã gọi' }).first().locator('.db-card__link').click();
await page.getByRole('heading', { name: 'Chi phí AI', exact: true }).waitFor({ state: 'visible' });
check('drill-down mở native AI Usage với period và request canonical',
  page.url().endsWith('/admin/system/ai-usage?days=30')
    && requests.some((request) => request.path === '/admin/ai-usage' && request.search === '?days=30'));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
