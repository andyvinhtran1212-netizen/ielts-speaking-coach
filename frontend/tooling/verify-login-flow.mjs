// Fixture-backed contract for the native /login auth entry.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3011';
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

async function fixture({ session, profile, ambiguousActivation = false, viewport = { width: 1280, height: 900 } }) {
  const context = await browser.newContext({ viewport });
  const errors = [];
  const reads = [];
  const writes = [];
  let canonical = { ...profile };
  const supabaseStub = `
window.__oauthInput = null;
window.supabase = {
  createClient: function () {
    return { auth: {
      getSession: async function () {
        return { data: { session: ${session ? "{ access_token: 'fixture-token', user: { id: 'user-1' } }" : 'null'} }, error: null };
      },
      signInWithOAuth: async function (input) {
        window.__oauthInput = input;
        return { error: null };
      }
    } };
  }
};`;

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('supabase-js')) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: supabaseStub });
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) return route.abort();
    if (url.origin === BASE) {
      if (request.isNavigationRequest() && ['/home', '/onboarding.html'].includes(url.pathname)) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<title>destination</title><h1>${url.pathname}</h1>` });
      }
      return route.continue();
    }
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (request.method() === 'GET' && url.pathname === '/auth/me') {
      reads.push(url.pathname);
      return json(canonical);
    }
    if (request.method() === 'POST' && url.pathname === '/auth/activate') {
      writes.push(JSON.parse(request.postData() || '{}'));
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

const expired = await fixture({ session: false, profile: {} });
await expired.page.goto(`${BASE}/login#access_token=expired`, { waitUntil: 'domcontentloaded' });
const expiredAlert = expired.page.locator('.lx-error');
await expiredAlert.waitFor();
const expiredMessage = await expiredAlert.textContent();
const expiredUrl = new URL(expired.page.url());
check('callback hết hạn vẫn xóa credential khỏi URL và không đọc profile',
  expiredUrl.pathname === '/login'
    && !expiredUrl.hash
    && expired.reads.length === 0,
  `url=${expiredUrl.pathname}${expiredUrl.search}${expiredUrl.hash}; reads=${expired.reads.length}; alert=${expiredMessage}; js=${expired.errors.join('|')}`);
await expired.context.close();

const denied = await fixture({ session: false, profile: {} });
await denied.page.goto(`${BASE}/login#error=access_denied&error_description=cancelled`, { waitUntil: 'domcontentloaded' });
await denied.page.locator('.lx-error').waitFor();
const deniedUrl = new URL(denied.page.url());
check('callback OAuth bị từ chối cũng xóa toàn bộ error material khỏi URL',
  deniedUrl.pathname === '/login' && !deniedUrl.search && !deniedUrl.hash && denied.reads.length === 0);
await denied.context.close();

const inactive = await fixture({
  session: true,
  profile: { id: 'user-1', is_active: false, onboarding_completed: false },
  ambiguousActivation: true,
});
await inactive.page.goto(`${BASE}/login#access_token=fixture`, { waitUntil: 'domcontentloaded' });
await inactive.page.getByRole('dialog', { name: 'Kích hoạt tài khoản' }).waitFor();
const codeInput = inactive.page.getByLabel('Access Code');
await codeInput.focus();
await inactive.page.keyboard.press('Shift+Tab');
const wrappedBackward = await inactive.page.getByRole('button', { name: 'Kích hoạt' }).evaluate((node) => node === document.activeElement);
await inactive.page.keyboard.press('Tab');
check('modal bắt focus trong hai control bắt buộc', wrappedBackward && await codeInput.evaluate((node) => node === document.activeElement));
check('implicit callback xóa token khỏi URL và dùng /auth/me để mở modal',
  new URL(inactive.page.url()).pathname === '/login'
    && !new URL(inactive.page.url()).hash
    && inactive.reads.length === 1);
await codeInput.fill(' ielts-test-001 ');
await inactive.page.getByRole('button', { name: 'Kích hoạt' }).click();
await inactive.page.waitForURL('**/onboarding.html');
check('mất ACK activation vẫn reconcile canonical truth rồi đi onboarding',
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

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nLogin flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
