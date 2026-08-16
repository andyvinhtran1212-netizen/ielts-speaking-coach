// Browser-backed contract for native `/admin/error-logs`.
// All API calls are fixture-backed: no production data is read or mutated.
//
//   node tooling/verify-admin-error-logs-flow.mjs [base]
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] || 'http://localhost:3011';
const SB = process.env.SUPABASE_URL || 'https://huwsmtubwulikhlmcirx.supabase.co';
const ROUTE = '/admin/error-logs';
const adminId = '00000000-0000-0000-0000-000000000094';
const fakeSession = JSON.stringify({
  access_token: 'admin-error-logs-flow-not-a-real-token',
  refresh_token: 'x', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: adminId, email: 'admin-errors@local' },
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launchChromium() {
  try { return await chromium.launch(); }
  catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome });
    throw error;
  }
}

const mainRow = {
  id: '11111111-1111-1111-1111-111111111111', level: 'error', source: 'frontend',
  message: "Cannot read properties of null (reading 'essay') <script>alert(1)</script>",
  stack: 'TypeError: <img src=x onerror=alert(1)>', url: '/writing/dashboard',
  user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', user_agent: '<svg onload=alert(1)>',
  request_id: 'req-1', occurred_at: '2026-08-12T01:02:03Z', dismissed_at: null,
  extra: { dangerous: '<iframe src=javascript:alert(1)>' },
};
const dbRow = {
  id: '22222222-2222-2222-2222-222222222222', level: 'error', source: 'backend',
  message: "{'message': 'null value in column \"prompt_version\" violates not-null constraint', 'code': '23502'}",
  stack: null, url: '/admin/writing/grade', user_id: null, user_agent: null,
  request_id: null, occurred_at: '2026-08-12T00:02:03Z', dismissed_at: null, extra: null,
};
const noiseRow = {
  id: '33333333-3333-3333-3333-333333333333', level: 'warning', source: 'backend',
  message: 'Test exception from /admin/error-logs/test endpoint', stack: null,
  url: '/admin/error-logs/test', user_id: null, user_agent: null, request_id: null,
  occurred_at: '2026-08-11T00:02:03Z', dismissed_at: null, extra: null,
};
const fillers = Array.from({ length: 47 }, (_, index) => ({
  ...dbRow,
  id: `44444444-4444-4444-4444-${String(index).padStart(12, '0')}`,
  message: `Backend fixture ${index + 1}`,
}));

let dismissed = false;
let testGenerated = false;
const requests = [];
const unexpectedWrites = [];
const allowedWrites = [
  /^POST \/admin\/error-logs\/[^/]+\/(dismiss|undismiss)$/,
  /^POST \/admin\/error-logs\/test$/,
  /^POST \/api\/(analytics\/events|error-logs)$/,
];

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(([key, value]) => {
  try { localStorage.setItem(key, value); } catch (_) {}
}, [storageKey(SB), fakeSession]);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.route('**/*', async (route) => {
  const request = route.request();
  const url = request.url();
  if (url.startsWith(BASE) || url.startsWith('data:')) return route.continue();
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
  const parsed = new URL(url);
  const method = request.method();
  requests.push({ method, path: parsed.pathname, search: parsed.search });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const signature = `${method} ${parsed.pathname}`;
    if (!allowedWrites.some((pattern) => pattern.test(signature))) unexpectedWrites.push(signature);
  }

  if (parsed.pathname === '/auth/me') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: adminId, email: 'admin-errors@local', role: 'admin' }) });
  }
  if (parsed.pathname === '/admin/error-logs/stats') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 1549, undismissed: dismissed ? 3 : 4, last_24h: 2, last_7d: 17 }) });
  }
  if (parsed.pathname === '/admin/error-logs/migration-stats') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      window_days: 7, scanned: 17, truncated: false,
      rows: [{ implementation: 'next', release: 'fixture1234', total: 8, undismissed: 2, by_level: { error: 7, warning: 1 } }],
    }) });
  }
  if (parsed.pathname === '/admin/error-logs/rollback-metrics') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      route: parsed.searchParams.get('route') || '/', match: parsed.searchParams.get('match') || 'exact',
      match_coerced_from: null, window_minutes: Number(parsed.searchParams.get('window_minutes')) || 30,
      window_minutes_requested: Number(parsed.searchParams.get('window_minutes')) || 30, window_clamped: false,
      windows: { table: 30, table_max: 129600, error_trigger: 30, vitals_trigger: 1440 },
      exposure: { evaluated_implementation: 'next', evaluated_views: 42, by_implementation: { next: 42, legacy: 7, untagged: 0 }, all_views: 49, exact: true, window_minutes: 30 },
      implementations: {
        next: { page_views: 42, errors: 2, error_rate: 0.0476, vitals: { lcp_p75: 1800, cls_p75: 0.03, inp_p75: 130, samples: 14 } },
        legacy: { page_views: 21, errors: 1, error_rate: 0.0476, vitals: { lcp_p75: 1700, cls_p75: 0.02, inp_p75: 120, samples: 12 } },
      },
      error_verdict: { status: 'ok', basis: 'relative', delta_x: 1, threshold_x: 2, baseline_source: 'legacy-window' },
      vitals_verdict: { status: 'ok', basis: 'relative', delta_x: 1.06, threshold_x: 1.5, baseline_source: 'legacy-window' },
      truncated: false,
    }) });
  }
  if (parsed.pathname === '/admin/error-logs' && method === 'GET') {
    const wantsDismissed = parsed.searchParams.get('dismissed');
    const source = parsed.searchParams.get('source');
    const offset = Number(parsed.searchParams.get('offset')) || 0;
    let items = [];
    if (wantsDismissed === 'true') {
      items = dismissed ? [{ ...mainRow, dismissed_at: '2026-08-12T02:00:00Z' }] : [];
    } else if (!dismissed) {
      items = source === 'backend' ? [dbRow] : source === 'frontend' ? [mainRow] : [mainRow, dbRow, noiseRow, ...fillers];
    }
    if (testGenerated && wantsDismissed !== 'true' && !items.some((row) => row.id === noiseRow.id)) items.push(noiseRow);
    if (offset >= 50) items = [{ ...dbRow, id: '55555555-5555-5555-5555-555555555555', message: 'Trang hai' }];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, limit: 50, offset }) });
  }
  const dismissMatch = parsed.pathname.match(/^\/admin\/error-logs\/([^/]+)\/dismiss$/);
  if (method === 'POST' && dismissMatch) {
    dismissed = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"dismissed":true}' });
  }
  const undismissMatch = parsed.pathname.match(/^\/admin\/error-logs\/([^/]+)\/undismiss$/);
  if (method === 'POST' && undismissMatch) {
    dismissed = false;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"undismissed":true}' });
  }
  if (method === 'POST' && parsed.pathname === '/admin/error-logs/test') {
    testGenerated = true;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"fixture exception"}' });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
try { await page.getByRole('heading', { name: 'Báo lỗi', exact: true }).waitFor({ state: 'visible' }); }
catch (error) {
  console.error('  URL:', page.url());
  console.error('  Body:', (await page.locator('body').innerText().catch(() => '')).slice(0, 900));
  console.error('  JS:', pageErrors.join(' | '));
  throw error;
}
await page.getByText('1.549', { exact: true }).waitFor({ state: 'visible' });
await page.getByText(/Truy cập "essay"/, { exact: false }).waitFor({ state: 'visible' });

check('backend-owned admin gate chạy trước surface', requests.some((item) => item.path === '/auth/me'));
check('mặc định đọc stats, migration và list chưa xử lý',
  requests.some((item) => item.path === '/admin/error-logs/stats')
    && requests.some((item) => item.path === '/admin/error-logs/migration-stats')
    && requests.some((item) => item.path === '/admin/error-logs' && item.search.includes('dismissed=false') && item.search.includes('limit=50')));
check('canonical số liệu và migration group hiển thị đúng',
  await page.getByText('1.549', { exact: true }).count() === 1
    && await page.getByText('fixture1234', { exact: true }).count() === 1
    && await page.getByText('error 7 · warning 1', { exact: true }).count() === 1);
check('noise mặc định bị ẩn nhưng trang server vẫn đủ 50 dòng',
  await page.getByText('Mục thử nghiệm — không phải lỗi thật', { exact: false }).count() === 0
    && await page.getByText('Dòng 1–50', { exact: true }).count() === 1);
check('dữ liệu độc hại được React escape',
  await page.locator('.el-log-panel script, .el-log-panel img, .el-log-panel svg, .el-log-panel iframe').count() === 0);

await page.getByRole('button', { name: 'Xem' }).first().click();
await page.getByText('Request ID:', { exact: true }).waitFor({ state: 'visible' });
check('disclosure có aria và hiển thị raw detail an toàn',
  await page.getByRole('button', { name: 'Ẩn' }).first().getAttribute('aria-expanded') === 'true'
    && await page.getByText('req-1', { exact: true }).count() === 1
    && await page.locator('.el-detail img, .el-detail svg, .el-detail iframe').count() === 0);

await page.getByRole('button', { name: 'Đánh dấu xử lý' }).click();
await page.getByText('Đã đánh dấu xử lý.', { exact: true }).waitFor({ state: 'visible' });
check('dismiss ghi đúng endpoint rồi reload canonical list',
  requests.filter((item) => item.method === 'POST' && /\/dismiss$/.test(item.path)).length === 1
    && await page.getByText(/Truy cập "essay"/, { exact: false }).count() === 0);

await page.getByLabel('Trạng thái').selectOption('true');
await page.getByText(/Truy cập "essay"/, { exact: false }).waitFor({ state: 'visible' });
await page.getByRole('button', { name: 'Xem' }).click();
await page.getByRole('button', { name: 'Reset (undo)' }).click();
await page.getByText('Đã reset.', { exact: true }).waitFor({ state: 'visible' });
check('undismiss ghi đúng endpoint rồi trạng thái persisted biến mất',
  requests.filter((item) => item.method === 'POST' && /\/undismiss$/.test(item.path)).length === 1
    && await page.getByText(/Truy cập "essay"/, { exact: false }).count() === 0);

await page.getByLabel('Trạng thái').selectOption('false');
await page.getByLabel('Nguồn').selectOption('backend');
await page.getByText(/prompt_version/, { exact: false }).first().waitFor({ state: 'visible' });
check('filter source đi qua backend query và humanize CSDL còn đúng',
  requests.some((item) => item.path === '/admin/error-logs' && item.search.includes('source=backend'))
    && await page.getByText('CSDL', { exact: true }).count() >= 1);

await page.getByLabel('Nguồn').selectOption('');
await page.getByRole('button', { name: 'Trang sau' }).click();
await page.getByText('Trang hai', { exact: false }).waitFor({ state: 'visible' });
check('phân trang gửi offset canonical và điều hướng đúng',
  requests.some((item) => item.path === '/admin/error-logs' && item.search.includes('offset=50'))
    && await page.getByText('Dòng 51–51', { exact: true }).count() === 1);
await page.getByRole('button', { name: 'Trang trước' }).click();
await page.getByText(/Truy cập "essay"/, { exact: false }).waitFor({ state: 'visible' });

await page.getByRole('textbox', { name: 'Route', exact: true }).fill('/grammar');
await page.getByRole('combobox', { name: 'Khớp', exact: true }).selectOption('prefix');
await page.getByRole('button', { name: 'Đo' }).click();
await page.getByText('42 lượt xem', { exact: false }).waitFor({ state: 'visible' });
check('rollback metrics giữ route/match/window và hiện hai frozen verdict',
  requests.some((item) => item.path === '/admin/error-logs/rollback-metrics' && item.search.includes('route=%2Fgrammar') && item.search.includes('match=prefix'))
    && await page.getByText('Error-rate (>2×/30ph):', { exact: true }).count() === 1
    && await page.getByText('LCP p75 (>1.5×/24h):', { exact: true }).count() === 1);

await page.getByRole('button', { name: 'Tạo lỗi test' }).click();
await page.getByText(/Đang tạo lỗi test/, { exact: false }).waitFor({ state: 'visible' });
await page.waitForFunction(() => {
  const checkbox = document.querySelector('input[type="checkbox"]');
  return checkbox && !checkbox.checked;
});
await page.waitForTimeout(950);
check('dogfood exception chấp nhận 500, bỏ ẩn noise và tự reload',
  requests.filter((item) => item.method === 'POST' && item.path === '/admin/error-logs/test').length === 1
    && await page.getByText('Mục thử nghiệm — không phải lỗi thật', { exact: false }).count() >= 1);

const readsBeforeRefresh = requests.length;
await page.getByRole('button', { name: 'Tải lại' }).click();
await page.waitForFunction(() => {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('Tải lại'));
  return button && !button.disabled;
});
const refreshReads = requests.slice(readsBeforeRefresh);
check('Tải lại gọi lại list, stats và migration',
  ['/admin/error-logs', '/admin/error-logs/stats', '/admin/error-logs/migration-stats']
    .every((path) => refreshReads.some((item) => item.path === path)));

const desktop = await page.evaluate(() => ({
  client: document.documentElement.clientWidth,
  scroll: document.documentElement.scrollWidth,
  right: document.querySelector('.el-shell')?.getBoundingClientRect().right || 0,
}));
check('desktop không tràn ngang', desktop.client === desktop.scroll && desktop.right <= desktop.client);
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(100);
const mobile = await page.evaluate(() => ({
  client: document.documentElement.clientWidth,
  scroll: document.documentElement.scrollWidth,
  right: document.querySelector('.el-shell')?.getBoundingClientRect().right || 0,
}));
check('mobile không tràn ngang', mobile.client === mobile.scroll && mobile.right <= mobile.client);
const tableScrolls = await page.locator('.el-log-table-wrap').evaluate((element) => {
  element.scrollLeft = 80;
  return element.scrollWidth > element.clientWidth && element.scrollLeft > 0;
});
check('bảng rộng vẫn cuộn ngang bên trong, không bị cắt mất cột', tableScrolls);
check('không phát mutation ngoài contract', unexpectedWrites.length === 0, unexpectedWrites.join(', '));
check('không có lỗi JS chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} đạt`);
process.exit(failed.length ? 1 : 0);
