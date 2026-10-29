// Fixture-backed contract for the native /login auth entry.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3011';
const API = 'https://api.login-fixture.invalid';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) {
      return chromium.launch({ executablePath: chrome });
    }
    throw error;
  }
}

const browser = await launch();

async function fixture({
  session,
  profile,
  ambiguousActivation = false,
  sessionMode = 'immediate',
  exchangeMode = 'ok',
  activationDelayMs = 0,
  viewport = { width: 1280, height: 900 },
}) {
  const context = await browser.newContext({ viewport });
  const errors = [];
  const reads = [];
  const writes = [];
  let canonical = { ...profile };
  const supabaseStub = `
window.__oauthInput = null;
window.__exchangeCodes = [];
window.__sessionWaiters = [];
window.__settleSessions = function (outcome) {
  var waiters = window.__sessionWaiters.splice(0);
  waiters.forEach(function (waiter) { waiter(outcome); });
};
window.__AVER_SUPABASE_CLIENT__ = { auth: {
      getSession: function () {
        var result = { data: { session: ${session ? "{ access_token: 'fixture-token', user: { id: 'user-1' } }" : 'null'} }, error: null };
        if (${JSON.stringify(sessionMode)} === 'immediate') return Promise.resolve(result);
        return new Promise(function (resolve, reject) {
          window.__sessionWaiters.push(function (outcome) {
            if (outcome === 'reject') reject(new Error('fixture getSession rejected'));
            else resolve(result);
          });
        });
      },
      exchangeCodeForSession: function (code) {
        window.__exchangeCodes.push(code);
        var ok = { data: { session: { access_token: 'fixture-token', user: { id: 'user-1' } } }, error: null };
        var failed = { data: { session: null }, error: { message: 'invalid flow state' } };
        var mode = ${JSON.stringify(exchangeMode)};
        if (mode !== 'pending') return Promise.resolve(mode === 'ok' ? ok : failed);
        return new Promise(function (resolve, reject) {
          window.__sessionWaiters.push(function (outcome) {
            if (outcome === 'reject') reject(new Error('fixture exchange rejected'));
            else resolve(failed);
          });
        });
      },
      signInWithOAuth: async function (input) {
        window.__oauthInput = input;
        return { error: null };
      }
    } };`;

  await context.addInitScript({ content: supabaseStub });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) return route.abort();
    if (url.origin === BASE) {
      if (url.pathname === '/js/runtime-config.js') {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({apiBase:${JSON.stringify(API)}});`,
        });
      }
      if (request.isNavigationRequest() && ['/home', '/onboarding'].includes(url.pathname)) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<title>destination</title><h1>${url.pathname}</h1>` });
      }
      return route.continue();
    }
    const cors = {
      'access-control-allow-origin': BASE,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,x-request-id',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (request.method() === 'GET' && url.pathname === '/auth/me') {
      reads.push(url.pathname);
      return json(canonical);
    }
    if (request.method() === 'POST' && url.pathname === '/auth/activate') {
      writes.push(JSON.parse(request.postData() || '{}'));
      if (activationDelayMs) await new Promise((resolve) => setTimeout(resolve, activationDelayMs));
      if (ambiguousActivation) {
        canonical = { ...canonical, is_active: true };
        return route.abort('connectionfailed');
      }
      canonical = { ...canonical, is_active: true };
      return json({ message: 'ok' });
    }
    if (url.pathname === '/api/public-stats') return json({ sessions_completed: 1234 });
    if (url.pathname === '/api/error-logs') return json({ ok: true });
    return json({});
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  return { context, page, errors, reads, writes };
}

const signedOut = await fixture({ session: false, profile: {} });
await signedOut.page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
const google = signedOut.page.getByRole('button', { name: 'Đăng nhập bằng Google' });
await google.waitFor();
await google.click();
const oauth = await signedOut.page.evaluate(() => window.__oauthInput);
check('signed-out hiển thị Google và OAuth quay về owner /login',
  signedOut.reads.length === 0 && oauth?.provider === 'google' && oauth?.options?.redirectTo === `${BASE}/login`);
await signedOut.page.setViewportSize({ width: 390, height: 844 });
check('mobile giữ form trong viewport và ẩn pitch phụ',
  await signedOut.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth
    && getComputedStyle(document.querySelector('.lx-pitch')).display === 'none'));
await signedOut.context.close();

// F06: the redirect carries only a PKCE `?code=`; it leaves the URL and the
// history entry before the exchange can settle, stall or reject.
const delayedCallback = await fixture({ session: false, profile: {}, exchangeMode: 'pending' });
await delayedCallback.page.goto(`${BASE}/login?code=delayed`, { waitUntil: 'domcontentloaded' });
await delayedCallback.page.waitForFunction(() => location.pathname === '/login'
  && !location.search
  && window.__sessionWaiters.length > 0);
const delayedUrlBeforeSettle = new URL(delayedCallback.page.url());
check('callback PKCE được xóa trước khi exchange đang chờ hoàn tất',
  delayedUrlBeforeSettle.pathname === '/login' && !delayedUrlBeforeSettle.search
    && JSON.stringify(await delayedCallback.page.evaluate(() => window.__exchangeCodes)) === '["delayed"]');
await delayedCallback.page.evaluate(() => window.__settleSessions('resolve'));
await delayedCallback.page.locator('.lx-error').waitFor();
check('exchange thất bại không đọc profile', delayedCallback.reads.length === 0);
await delayedCallback.context.close();

const rejectedCallback = await fixture({ session: false, profile: {}, exchangeMode: 'pending' });
await rejectedCallback.page.goto(`${BASE}/login?code=pkce-fixture`, { waitUntil: 'domcontentloaded' });
await rejectedCallback.page.waitForFunction(() => location.pathname === '/login'
  && !location.search
  && window.__sessionWaiters.length > 0);
const rejectedUrlBeforeSettle = new URL(rejectedCallback.page.url());
await rejectedCallback.page.evaluate(() => window.__settleSessions('reject'));
await rejectedCallback.page.locator('.lx-error').waitFor();
const rejectedUrlAfterSettle = new URL(rejectedCallback.page.url());
check('callback PKCE vẫn sạch khi exchange reject',
  rejectedUrlBeforeSettle.pathname === '/login'
    && !rejectedUrlBeforeSettle.search
    && rejectedUrlAfterSettle.pathname === '/login'
    && !rejectedUrlAfterSettle.search);
await rejectedCallback.context.close();

// An implicit-flow fragment is stale or forged now that the client is
// PKCE-only: scrub it and refuse it, even with a stored session present.
const implicitFragment = await fixture({ session: true, profile: { id: 'user-1', is_active: true, onboarding_completed: true } });
await implicitFragment.page.goto(`${BASE}/login#access_token=forged&refresh_token=r&expires_in=3600&token_type=bearer`, { waitUntil: 'domcontentloaded' });
const implicitAlert = implicitFragment.page.locator('.lx-error');
await implicitAlert.waitFor();
const implicitMessage = await implicitAlert.textContent();
const implicitUrl = new URL(implicitFragment.page.url());
check('fragment #access_token bị xóa khỏi URL, không exchange, không đọc profile',
  implicitUrl.pathname === '/login'
    && !implicitUrl.hash
    && implicitFragment.reads.length === 0
    && (await implicitFragment.page.evaluate(() => window.__exchangeCodes.length)) === 0,
  `url=${implicitUrl.pathname}${implicitUrl.search}${implicitUrl.hash}; reads=${implicitFragment.reads.length}; alert=${implicitMessage}; js=${implicitFragment.errors.join('|')}`);
await implicitFragment.context.close();

for (const [label, suffix] of [['fragment', '#error=access_denied&error_description=cancelled'],
  ['query PKCE', '?error=access_denied&error_code=bad_oauth_state&error_description=cancelled']]) {
  const denied = await fixture({ session: false, profile: {} });
  await denied.page.goto(`${BASE}/login${suffix}`, { waitUntil: 'domcontentloaded' });
  await denied.page.locator('.lx-error').waitFor();
  const deniedUrl = new URL(denied.page.url());
  check(`callback OAuth bị từ chối (${label}) xóa toàn bộ error material khỏi URL`,
    deniedUrl.pathname === '/login' && !deniedUrl.search && !deniedUrl.hash && denied.reads.length === 0
      && (await denied.page.evaluate(() => window.__exchangeCodes.length)) === 0);
  await denied.context.close();
}

const inactive = await fixture({
  session: true,
  profile: { id: 'user-1', is_active: false, onboarding_completed: false },
  ambiguousActivation: true,
  activationDelayMs: 150,
});
await inactive.page.goto(`${BASE}/login?code=fixture`, { waitUntil: 'domcontentloaded' });
try {
  await inactive.page.getByRole('dialog', { name: 'Kích hoạt tài khoản' }).waitFor();
} catch (error) {
  const state = await inactive.page.evaluate(() => ({
    url: location.href,
    busy: document.querySelector('.lx-loading')?.textContent?.trim() || '',
    error: document.querySelector('.lx-error')?.textContent?.trim() || '',
  }));
  throw new Error(`Activation dialog did not open: ${JSON.stringify(state)}; js=${inactive.errors.join('|')}`, { cause: error });
}
const codeInput = inactive.page.getByLabel('Access Code');
await codeInput.focus();
// BL-13: Đăng xuất is the dialog's last control (the way out for a wrong account).
await inactive.page.keyboard.press('Shift+Tab');
const wrappedBackward = await inactive.page.getByRole('button', { name: 'Đăng xuất' }).evaluate((node) => node === document.activeElement);
await inactive.page.keyboard.press('Tab');
const wrappedForward = await codeInput.evaluate((node) => node === document.activeElement);
await inactive.page.keyboard.press('Tab');
const reachesActivate = await inactive.page.getByRole('button', { name: 'Kích hoạt' }).evaluate((node) => node === document.activeElement);
await codeInput.focus();
check('modal bắt focus trong mã, Kích hoạt và Đăng xuất', wrappedBackward && wrappedForward && reachesActivate);
// PC-J25: Đăng xuất keeps a ≥44×44px touch target on desktop and mobile.
const signOutBox = inactive.page.getByRole('button', { name: 'Đăng xuất' });
// Measure the settled layout, not a frame of the scale-in entry animation.
await inactive.page.evaluate(() => Promise.all(document.querySelector('.lx-dialog')
  .getAnimations().map((animation) => animation.finished)));
const signOutSizes = [];
for (const size of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  await inactive.page.setViewportSize(size);
  const box = await signOutBox.boundingBox();
  signOutSizes.push(`${size.width}: ${box ? `${box.width.toFixed(2)}×${box.height.toFixed(2)}` : 'hidden'}`);
  if (!box || box.width < 44 || box.height < 44) signOutSizes.push('too small');
}
await inactive.page.setViewportSize({ width: 1280, height: 900 });
check('Đăng xuất có vùng chạm ≥ 44×44px ở 1280 và 390', !signOutSizes.includes('too small'), signOutSizes.join('; '));
check('callback PKCE xóa code khỏi URL, exchange một lần và dùng /auth/me để mở modal',
  new URL(inactive.page.url()).pathname === '/login'
    && !new URL(inactive.page.url()).search
    && JSON.stringify(await inactive.page.evaluate(() => window.__exchangeCodes)) === '["fixture"]'
    && inactive.reads.length === 1);
await codeInput.fill(' ielts-test-001 ');
await codeInput.evaluate((node) => {
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await inactive.page.waitForURL('**/onboarding');
check('Enter lặp chỉ gửi một activation; mất ACK vẫn reconcile rồi đi onboarding',
  inactive.writes.length === 1
    && inactive.writes[0].access_code === 'IELTS-TEST-001'
    && inactive.reads.length === 2);
check('callback/activation không có lỗi JS', inactive.errors.length === 0, inactive.errors.join(' | '));
await inactive.context.close();

const ready = await fixture({
  session: true,
  profile: { id: 'user-1', is_active: true, onboarding_completed: true },
});
await ready.page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await ready.page.waitForURL('**/home');
check('session active + onboarded đi home từ canonical profile', ready.reads.length === 1);
check('existing-session không có lỗi JS', ready.errors.length === 0, ready.errors.join(' | '));
await ready.context.close();

// F06 end to end with the REAL bundled supabase-js client (no injected stub):
// Google → GoTrue /authorize (PKCE challenge) → /login?code= → verifier-bound
// token exchange → /home → chrome logout → signed-out /login. Only GoTrue and
// the API are faked. No URL the tab ever visits, and no history entry left
// behind, may carry a token — and the one-time code must not survive either.
{
  const AUTH = 'https://auth.login-fixture.invalid';
  const ACCESS = `h.${Buffer.from(JSON.stringify({ sub: 'user-1', session_id: 'sid-pkce', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;
  const authorize = [];
  const exchanges = [];
  const logouts = [];
  const reads = [];
  const errors = [];
  const visited = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname) || url.hostname === 'unpkg.com') return route.abort();
    if (url.origin === BASE) {
      if (url.pathname === '/js/runtime-config.js') {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze(${JSON.stringify({ apiBase: API, supabaseUrl: AUTH, supabaseAnonKey: 'fixture-anon' })});`,
        });
      }
      if (request.isNavigationRequest() && url.pathname === '/') {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>landing</title><h1>/</h1>' });
      }
      return route.continue();
    }
    const cors = {
      'access-control-allow-origin': BASE,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'authorization,content-type',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (url.origin === AUTH) {
      if (url.pathname === '/auth/v1/authorize') {
        authorize.push(Object.fromEntries(url.searchParams));
        return route.fulfill({ status: 302, headers: { location: `${url.searchParams.get('redirect_to')}?code=pkce-code-1` }, body: '' });
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
        const body = JSON.parse(request.postData() || '{}');
        exchanges.push(body);
        const challenge = authorize[0]?.code_challenge;
        const proven = body.auth_code === 'pkce-code-1' && typeof body.code_verifier === 'string'
          && createHash('sha256').update(body.code_verifier).digest('base64url') === challenge;
        if (!proven) return json({ error: 'invalid_grant', error_description: 'code verifier mismatch' }, 400);
        return json({
          access_token: ACCESS, refresh_token: 'refresh-1', expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer',
          user: { id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'learner@example.test' },
        });
      }
      if (url.pathname === '/auth/v1/logout') {
        logouts.push(request.headers().authorization || '');
        return route.fulfill({ status: 204, headers: cors, body: '' });
      }
      return json({ message: `unexpected ${url.pathname}` }, 500);
    }
    if (url.pathname === '/auth/me') {
      reads.push(request.headers().authorization || '');
      return json({ id: 'user-1', email: 'learner@example.test', display_name: 'PKCE Learner', role: 'user', is_active: true, onboarding_completed: true });
    }
    if (url.pathname === '/api/student/home-summary') {
      return json({ student: { name: 'PKCE Learner' }, streak: { current_days: 0 }, totals: { speaking_sessions: 0, writing_essays: 0 }, skills: {} });
    }
    if (url.pathname === '/api/class/me') return json({ has_class: false });
    if (url.pathname.includes('assignments') || url.pathname.includes('sessions')) return json([]);
    return json({});
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) visited.push(frame.url()); });
  const authStorage = () => page.evaluate(() => Object.keys(localStorage).filter((key) => /^sb-.*-auth-token/.test(key)));

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Đăng nhập bằng Google' }).click();
  const signedIn = await page.waitForURL('**/home', { timeout: 15_000 }).then(() => true, () => false);
  const oauth = authorize[0] || {};
  check('client thật xin Google qua PKCE (S256) và quay về owner /login',
    authorize.length === 1 && oauth.provider === 'google' && oauth.redirect_to === `${BASE}/login`
      && String(oauth.code_challenge_method).toLowerCase() === 's256' && Boolean(oauth.code_challenge),
    JSON.stringify(oauth));
  check('code được đổi đúng một lần bằng verifier của trình duyệt này',
    exchanges.length === 1 && reads.length >= 1 && reads[0] === `Bearer ${ACCESS}`,
    `exchanges=${exchanges.length}; reads=${reads.length}`);
  // The redirect necessarily lands on /login?code= (a one-time code, useless
  // without this browser's verifier); tokens never reach any URL, and the
  // code does not survive in the session history.
  const tokenUrls = visited.filter((href) => /access_token|refresh_token/.test(href));
  check('không URL nào tab đã đi qua mang access/refresh token', tokenUrls.length === 0 && visited.length > 0,
    `visited=${visited.join(' ')}`);
  const history = (await (await context.newCDPSession(page)).send('Page.getNavigationHistory')).entries.map((entry) => entry.url);
  check('history không giữ token hay code', !history.some((href) => /access_token|refresh_token|[?&#]code=/.test(href)),
    `history=${history.join(' ')}`);
  check('session lưu ngoài URL, verifier dùng một lần đã bị xóa',
    JSON.stringify(await authStorage()) === '["sb-auth-auth-token"]');

  check('PKCE callback đăng nhập vào /home', signedIn, page.url());
  if (signedIn) {
    const chrome = page.locator('aver-chrome');
    await chrome.locator('#user-pill').click();
    await chrome.locator('#user-menu-logout').click();
    await page.waitForURL(`${BASE}/`);
    check('logout thu hồi đúng session PKCE và xóa storage',
      logouts.length === 1 && logouts[0] === `Bearer ${ACCESS}` && (await authStorage()).length === 0,
      `logouts=${logouts.length}`);
    const readsBeforeReturn = reads.length;
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Đăng nhập bằng Google' }).waitFor();
    check('sau logout /login signed-out, không gửi session cũ tới /auth/me', reads.length === readsBeforeReturn);
  }
  check('journey PKCE thật không có lỗi JS', errors.length === 0, errors.join(' | '));
  await context.close();
}

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nLogin flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
