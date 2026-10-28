// Hermetic browser regression for PC-J13 error states (U-16, BL-01, BL-08, BL-13).
//
// U-16: /quiz, /mock-exam and /grammar-lessons/assigned opened without their
//       query parameter showed a raw message ("Thiếu tham số bank.", "Missing
//       test code or attempt ID.") next to a retry button that could never
//       succeed. They now explain what is missing and offer only a way back.
// BL-01: the gated debug routes answered 404 with no <title> in the served
//       head and, after hydration, the debug page's own title.
// BL-08: /grammar-checkup kept showing the previous account's session after
//       an account switch in another tab.
// BL-13: the activation dialog on /login had no way to sign out.
//
// Set SHOT_DIR=<dir> to also write screenshots for the PR evidence.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3000';
const api = new URL(process.env.AVER_API_BASE || 'http://127.0.0.1:3999');
if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname)
    || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
  throw new Error('AVER_API_BASE must be an explicit local fixture origin');
}
const API = api.origin;
const SHOT_DIR = process.env.SHOT_DIR || '';
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const USER_A = '00000000-0000-4000-8000-0000000005a1';
const USER_B = '00000000-0000-4000-8000-0000000005b2';
const STORE_KEY = 'sb-example-auth-token';

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

// The Supabase client is a stub whose session can be swapped from the test,
// firing onAuthStateChange like supabase-js does for a cross-tab change.
async function newPage(browser, { width, user, me = null, handlers = {} }) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, bypassCSP: true });
  await context.addInitScript({ content: `
window.__q85 = { listeners: [], signOuts: 0, session: ${user ? `{ access_token: 'token-${user}', user: { id: '${user}', email: null } }` : 'null'} };
if (window.__q85.session) { try { localStorage.setItem('${STORE_KEY}', JSON.stringify(window.__q85.session)); } catch (e) {} }
window.__q85.switchTo = function (id) {
  window.__q85.session = { access_token: 'token-' + id, user: { id: id, email: null } };
  window.__q85.listeners.forEach(function (cb) { cb('SIGNED_IN', window.__q85.session); });
};
window.__AVER_SUPABASE_CLIENT__ = { auth: {
  getSession: async function () { return { data: { session: window.__q85.session }, error: null }; },
  onAuthStateChange: function (cb) { window.__q85.listeners.push(cb); return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () {
    window.__q85.signOuts += 1;
    window.__q85.session = null;
    try { localStorage.removeItem('${STORE_KEY}'); } catch (e) {}
    return { error: null };
  },
  signInWithOAuth: async function () { return { error: null }; },
  exchangeCodeForSession: async function () { return { data: { session: null }, error: null }; }
} };
` });
  const requests = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname) || url.hostname === 'unpkg.com') return route.abort();
    if (url.origin === BASE && url.pathname === '/js/runtime-config.js') {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `window.__AVER_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify({
          environment: 'test', apiBase: API,
          supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'test-anon-key',
        })});`,
      });
    }
    if (url.origin === BASE) return route.continue();
    if (url.origin !== API) return route.abort();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-request-id' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const auth = request.headers().authorization || '';
    requests.push(`${request.method()} ${url.pathname} ${auth}`);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    const handler = handlers[`${request.method()} ${url.pathname}`];
    if (handler) return json(...[].concat(handler(auth)));
    if (url.pathname === '/auth/me') return json(me || { id: user, is_active: true, onboarding_completed: true, role: 'user' });
    if (url.pathname === '/auth/check-active') return json({ is_active: true });
    return json({});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { page, requests, errors };
}

const hrefOf = async (locator) => (await locator.count() === 1 ? locator.getAttribute('href') : null);
const overflowOf = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);

const browser = await launch();
try {
  for (const width of [360, 390]) {
    const tag = `${width}px`;

    // ── U-16 /quiz ─────────────────────────────────────────────────────
    for (const [query, expected] of [['', 'chưa cho biết cần mở bài kiểm tra nào'], ['?bank=a&bank=b', 'không hợp lệ']]) {
      const { page, requests } = await newPage(browser, { width, user: USER_A });
      await page.goto(`${BASE}/quiz${query}`, { waitUntil: 'networkidle' });
      const alert = page.getByRole('alert').filter({ hasText: 'Không thể mở bài' });
      await alert.waitFor({ timeout: 15_000 });
      const text = await alert.innerText();
      check(`${tag} /quiz${query} explains the link problem`, text.includes(expected) && !/tham số|bank\./.test(text), JSON.stringify(text));
      check(`${tag} /quiz${query} offers no retry that cannot succeed`, await page.getByRole('button', { name: 'Mở lại bài' }).count() === 0);
      const back = alert.getByRole('link', { name: 'Quay lại' });
      check(`${tag} /quiz${query} has a back button`, await hrefOf(back) === '/vocabulary/practice');
      check(`${tag} /quiz${query} does not fetch a bank list`, !requests.some((row) => row.includes('/banks')), requests.join(' | '));
      check(`${tag} /quiz${query} has no horizontal overflow`, await overflowOf(page) <= 1);
      if (SHOT_DIR && !query) await page.screenshot({ path: join(SHOT_DIR, `quiz-missing-${width}.png`) });
      await page.context().close();
    }

    // ── U-16 /mock-exam ────────────────────────────────────────────────
    {
      const { page } = await newPage(browser, { width, user: USER_A });
      await page.goto(`${BASE}/mock-exam`, { waitUntil: 'networkidle' });
      const alert = page.getByRole('alert').filter({ hasText: 'Unable to open the test' });
      await alert.waitFor({ timeout: 15_000 });
      const text = await alert.innerText();
      check(`${tag} /mock-exam explains the link problem`, /does not say which test to open/.test(text) && !/attempt ID/.test(text), JSON.stringify(text));
      check(`${tag} /mock-exam offers no retry`, await page.getByRole('button', { name: 'Retry' }).count() === 0);
      check(`${tag} /mock-exam has a back button to Full Test`,
        await hrefOf(alert.getByRole('link', { name: 'Back to Full Test' })) === '/full-test');
      check(`${tag} /mock-exam has no horizontal overflow`, await overflowOf(page) <= 1);
      if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `mock-exam-missing-${width}.png`) });
      await page.context().close();
    }

    // ── U-16 /grammar-lessons/assigned ─────────────────────────────────
    {
      const { page, requests } = await newPage(browser, { width, user: USER_A });
      await page.goto(`${BASE}/grammar-lessons/assigned`, { waitUntil: 'networkidle' });
      const alert = page.locator('.agl-alert[role="alert"]');
      await alert.waitFor({ timeout: 15_000 });
      const text = await alert.innerText();
      check(`${tag} /grammar-lessons/assigned explains the link problem`, /chưa cho biết bài Grammar nào/.test(text) && !/Thiếu mã/.test(text), JSON.stringify(text));
      check(`${tag} /grammar-lessons/assigned offers no retry`, await page.getByRole('button', { name: 'Thử lại' }).count() === 0);
      check(`${tag} /grammar-lessons/assigned has a back button`,
        await hrefOf(page.getByRole('link', { name: '← Về Lớp của tôi' })) === '/my-class');
      check(`${tag} /grammar-lessons/assigned calls no lesson API`, !requests.some((row) => row.includes('/api/grammar/lessons')), requests.join(' | '));
      check(`${tag} /grammar-lessons/assigned has no horizontal overflow`, await overflowOf(page) <= 1);
      if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `grammar-lesson-missing-${width}.png`) });
      await page.context().close();
    }

    // ── BL-13 activation dialog sign-out ──────────────────────────────
    {
      const { page, errors } = await newPage(browser, {
        width, user: USER_A, me: { id: USER_A, is_active: false, onboarding_completed: false },
      });
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      const dialog = page.getByRole('dialog', { name: 'Kích hoạt tài khoản' });
      await dialog.waitFor({ timeout: 15_000 });
      const signOut = dialog.getByRole('button', { name: 'Đăng xuất' });
      check(`${tag} activation dialog offers Đăng xuất`, await signOut.isVisible());
      if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `login-activation-${width}.png`) });
      if (await signOut.count()) await signOut.click();
      await dialog.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
      const state = await page.evaluate((key) => ({ signOuts: window.__q85.signOuts, stored: localStorage.getItem(key) }), STORE_KEY);
      check(`${tag} Đăng xuất revokes and clears the session`, state.signOuts === 1 && state.stored === null, JSON.stringify(state));
      check(`${tag} after Đăng xuất the Google sign-in is offered`, await page.getByRole('button', { name: 'Đăng nhập bằng Google' }).isVisible());
      check(`${tag} the activation dialog is closed`, await dialog.count() === 0);
      check(`${tag} /login sign-out has no JS errors`, errors.length === 0, errors.join(' | '));
      await page.context().close();
    }

    // ── BL-08 /grammar-checkup follows an account switch ──────────────
    {
      const { page, requests } = await newPage(browser, {
        width, user: USER_A,
        handlers: {
          'GET /api/grammar/diagnostics/sessions/session-a': () => ({ id: 'session-a', status: 'in_progress', test_length: 'QUICK' }),
          'POST /api/grammar/diagnostics/sessions/session-a/next': () => ({
            complete: false,
            item: { item_id: 'a-1', ordinal: 3, total: 28, phase: 'BASELINE', prompt: 'Question owned by account A', options: ['one', 'two'] },
          }),
          'GET /api/grammar/diagnostics/availability': () => ({ assigned_only: false }),
        },
      });
      await page.goto(`${BASE}/grammar-checkup?session=session-a`, { waitUntil: 'networkidle' });
      await page.getByText('Question owned by account A').waitFor({ timeout: 15_000 });
      await page.evaluate((id) => window.__q85.switchTo(id), USER_B);
      await page.getByRole('heading', { name: 'Chọn độ sâu phù hợp' }).waitFor({ timeout: 15_000 }).catch(() => {});
      check(`${tag} /grammar-checkup drops account A's question after the switch`, await page.getByText('Question owned by account A').count() === 0);
      check(`${tag} /grammar-checkup drops A's session from the URL`, new URL(page.url()).search === '', page.url());
      const afterSwitch = requests.slice(requests.findIndex((row) => row.includes(`token-${USER_B}`)));
      check(`${tag} /grammar-checkup boots for account B`,
        afterSwitch.some((row) => row.startsWith('GET /api/grammar/diagnostics/availability') && row.includes(`token-${USER_B}`))
        && !afterSwitch.some((row) => row.includes('session-a')), afterSwitch.join(' | '));
      await page.context().close();
    }
  }

  // ── BL-01 gated debug routes ─────────────────────────────────────────
  {
    const { page } = await newPage(browser, { width: 390, user: null });
    for (const route of ['/next-probe', '/recorder-spike']) {
      const response = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const titles = await page.evaluate(() => [...document.querySelectorAll('title')].map((node) => node.textContent));
      check(`${route} is a 404 with the site 404 title`, response?.status() === 404 && titles.length === 1 && titles[0] === 'Aver Learning',
        `HTTP ${response?.status()} titles ${JSON.stringify(titles)}`);
    }
    await page.context().close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nverify-error-states-flow: all checks passed');
