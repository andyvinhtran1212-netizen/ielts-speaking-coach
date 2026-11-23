// Fixture-backed browser contract for staff quick search (ADMINIA-0074
// FR-075, FR-102; G09-T19). Every API call is intercepted; no real data is
// read or mutated.
//
//   node tooling/verify-staff-quick-search-flow.mjs [base] [--shots <dir>]
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

import { stubAdminMfaStatus } from './admin-mfa-stub.mjs';
import { storageKey } from './supabase-session.mjs';

const BASE = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:3011';
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const FIXTURE_API_PREFIX = '/__fixture_api';
const fixtureRuntime = `window.__AVER_RUNTIME_CONFIG__=Object.freeze({environment:'local-test',apiBase:${JSON.stringify(`${BASE}${FIXTURE_API_PREFIX}`)},supabaseUrl:null,supabaseAnonKey:null,release:null,gitRef:null,coreOperationCorrelationEnabled:false,writingAdmissionEnabled:false});`;
const SB = process.env.SUPABASE_URL || 'https://zjphffoujxkpltixsbzj.supabase.co';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launchChromium() {
  // PLAYWRIGHT_CHROMIUM_PATH: a preinstalled browser when the pinned one is absent.
  try { return await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}); }
  catch (error) {
    const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(localChrome)) return chromium.launch({ executablePath: localChrome });
    throw error;
  }
}

const hit = (title, meta, href) => ({ title, meta, href });
const ADMIN = {
  learners: [hit('Nguyễn Thị Lan', 'HV001 · Tue–Thu 19:30', '/admin/students'), hit('Lan Phạm', null, '/admin/students')],
  classes: [hit('Tue–Thu 19:30', 'TT19', '/admin/classes/co-1')],
  submissions: [hit('Task 2 · Nguyễn Thị Lan', '20/11', '/admin/writing/grade?essay_id=e-1')],
  content: [hit('Lan and the city', 'Writing · Task 1', '/admin/writing/prompts?q=x')],
  orders: [],
  sources_failed: [],
  unavailable: ['orders'],
};
const TEACHER = {
  learners: [hit('Nguyễn Thị Lan', 'HV001 · Tue–Thu 19:30', '/instructor')],
  classes: [hit('Tue–Thu 19:30', 'TT19', '/instructor')],
  submissions: [],
  sources_failed: ['submissions'],
  unavailable: [],
};

const browser = await launchChromium();

async function run({ name, path, role, door, viewport }) {
  const userId = `00000000-0000-0000-0000-0000000001${door === 'admin' ? '01' : '02'}`;
  const context = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1 });
  const session = JSON.stringify({
    access_token: 'quick-search-flow-not-a-real-token', refresh_token: 'x', token_type: 'bearer',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, email: `${role}-quick-search@local` },
  });
  await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (_) {} }, [storageKey(SB), session]);
  const page = await context.newPage();
  const pageErrors = [];
  const searches = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const routed = new URL(url).pathname;
    if (url.startsWith(BASE) && routed === '/js/runtime-config.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: fixtureRuntime });
    if ((url.startsWith(BASE) && !routed.startsWith(FIXTURE_API_PREFIX)) || url.startsWith('data:')) return route.continue();
    if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.continue();
    const parsed = new URL(url);
    const api = parsed.pathname.startsWith(FIXTURE_API_PREFIX) ? parsed.pathname.slice(FIXTURE_API_PREFIX.length) : parsed.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (api === '/auth/me') return json({ id: userId, email: `${role}-quick-search@local`, role, is_active: true });
    if (api.endsWith('/search')) {
      searches.push({ method: request.method(), path: api, search: parsed.search, body: request.postData() });
      if (request.method() !== 'POST') return json({ detail: 'Method Not Allowed' }, 405);
      return json(api === '/admin/search' ? ADMIN : TEACHER);
    }
    return json({});
  });
  await stubAdminMfaStatus(page);

  console.log(`\n${name}`);
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const dialog = page.getByRole('dialog', { name: 'Tìm nhanh' });
  if (door === 'admin') {
    const trigger = page.locator('aver-admin-chrome').locator('#quick-search');
    await trigger.waitFor({ state: 'visible', timeout: 8000 }).catch(async (e) => { console.error('URL', page.url(), (await page.locator('body').innerText()).slice(0, 600), pageErrors); throw e; });
    check('nút "Tìm nhanh" có trên thanh trên', await trigger.count() === 1);
    await trigger.click();
  } else {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Control+k');
  }
  await dialog.waitFor({ state: 'visible' });
  const input = dialog.getByRole('combobox');
  check('mở hộp tìm nhanh, focus ở ô nhập', await input.evaluate((el) => el === document.activeElement));
  check('dialog có aria-modal', await dialog.getAttribute('aria-modal') === 'true');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-1-open.png` });

  await input.fill('l');
  await page.waitForTimeout(400);
  check('1 ký tự: không gọi API', searches.length === 0);
  await input.fill('Lan');
  await dialog.getByRole('option').first().waitFor({ state: 'visible' });
  const sent = searches.at(-1);
  check(`gọi POST ${door === 'admin' ? '/admin/search' : '/instructor/search'} một lần`,
    searches.length === 1 && sent.method === 'POST' && sent.path === `/${door}/search`, JSON.stringify(searches));
  check('q nằm trong body, không trên URL', sent.search === '' && JSON.parse(sent.body || '{}').q === 'Lan');
  const groups = await dialog.getByRole('group').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  const want = door === 'admin' ? ['Học viên', 'Lớp', 'Bài nộp', 'Đề'] : ['Học viên', 'Lớp'];
  check('nhóm đúng thứ tự, nhóm rỗng bị ẩn', JSON.stringify(groups) === JSON.stringify(want), groups.join(', '));
  if (door === 'instructor') {
    check('nhóm đọc lỗi được nói rõ', (await dialog.getByRole('alert').innerText()).includes('Bài nộp'));
  }
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  check('↓ chọn dòng thứ hai', await dialog.getByRole('option').nth(1).getAttribute('aria-selected') === 'true');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-2-results.png` });

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  check('Esc đóng hộp', await dialog.count() === 0);

  // Open again: the last query is not kept, then Enter opens the chosen row.
  await page.keyboard.press('Control+k');
  await dialog.waitFor({ state: 'visible' });
  check('mở lại không giữ truy vấn cũ', await dialog.getByRole('combobox').inputValue() === '');
  await dialog.getByRole('combobox').fill('Lan');
  await dialog.getByRole('option').first().waitFor({ state: 'visible' });
  await page.keyboard.press('ArrowDown');
  const target = door === 'admin' ? '/admin/students' : '/instructor';
  await Promise.all([page.waitForURL((u) => u.pathname === target), page.keyboard.press('Enter')]);
  check(`Enter mở ${target}`, new URL(page.url()).pathname === target);
  check('không lỗi JS', pageErrors.length === 0, pageErrors.join(' | '));
  await context.close();
}

try {
  await run({ name: 'admin-1365', path: '/admin/classes', role: 'admin', door: 'admin', viewport: { width: 1365, height: 900 } });
  await run({ name: 'teacher-1365', path: '/instructor', role: 'instructor', door: 'instructor', viewport: { width: 1365, height: 900 } });
  if (SHOTS) await run({ name: 'admin-390', path: '/admin/classes', role: 'admin', door: 'admin', viewport: { width: 390, height: 844 } });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt`);
if (failed.length) process.exitCode = 1;
