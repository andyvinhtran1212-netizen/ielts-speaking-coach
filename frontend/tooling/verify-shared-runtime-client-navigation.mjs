// Browser proof that shared auth/telemetry runtime survives a real App Router
// soft navigation. All backend/CDN calls are fixture-backed; no external write.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3011';
const API = 'https://api.shared-runtime.invalid';
const sessionId = '00000000-0000-4000-8000-000000000711';
const userId = '00000000-0000-4000-8000-000000000712';
const analyticsPaths = [];
const vitals = [];
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

async function waitFor(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

const session = {
  id: sessionId,
  user_id: userId,
  status: 'completed',
  mode: 'practice',
  part: 1,
  topic: 'Client navigation fixture',
  started_at: '2026-09-07T00:00:00Z',
  overall_band: null,
  band_fc: null,
  band_lr: null,
  band_gra: null,
  band_p: null,
  question_lookup_failed: false,
  response_lookup_failed: false,
  questions: [],
  responses: [],
};

const supabaseStub = `
window.__fixtureSupabaseCreates = window.__fixtureSupabaseCreates || 0;
window.__fixtureSupabaseCreates += 1;
window.__fixtureSupabaseClient = window.__fixtureSupabaseClient || { marker: 'shared-client', auth: {
    getSession: async function () { return { data: { session: { access_token: 'fixture-token', user: { id: '${userId}', email: 'runtime@example.test' } } }, error: null }; },
    onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    signOut: async function () { return { error: null }; }
  } };
window.__AVER_SUPABASE_CLIENT__ = window.__fixtureSupabaseClient;`;

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript({ content: supabaseStub });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin === BASE) {
    if (url.pathname === '/js/runtime-config.js') {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({apiBase:${JSON.stringify(API)}});`,
      });
    }
    return route.continue();
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname) || url.hostname === 'unpkg.com') {
    return route.abort();
  }

  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-request-id',
  };
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
  const json = (body) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  });

  if (request.method() === 'POST' && url.pathname === '/api/analytics/events') {
    const payload = request.postDataJSON();
    if (payload?.event_name === 'page_view') analyticsPaths.push(payload.event_data?.path);
    if (payload?.event_name === 'web_vitals') vitals.push(payload.event_data);
    return json({ ok: true });
  }
  if (request.method() === 'GET' && url.pathname === '/auth/me') {
    return json({
      id: userId,
      email: 'runtime@example.test',
      display_name: 'Runtime Fixture',
      avatar_url: null,
      role: 'admin',
      is_active: true,
      permissions: ['all'],
      onboarding_completed: true,
      target_band: null,
      exam_date: null,
      self_level: null,
      preferred_topics: [],
      vocab_bank_enabled: true,
      d1_enabled: true,
      d3_enabled: true,
      flashcard_enabled: true,
      vocab_curated_enabled: true,
    });
  }
  if (request.method() === 'GET' && url.pathname === `/sessions/${sessionId}`) return json(session);
  if (request.method() === 'GET' && url.pathname === `/sessions/${sessionId}/audio-urls`) return json([]);
  if (request.method() === 'GET' && /\/topics\?part=/.test(url.pathname + url.search)) {
    return json([{ title: 'Fixture topic', category: 'Daily life' }]);
  }
  if (request.method() === 'GET' && url.pathname === '/api/dashboard/init') {
    return json({ summary: { total_sessions: 0 }, sessions: [] });
  }
  if (request.method() === 'GET' && url.pathname === '/sessions') {
    return json({ sessions: [], total: 0, total_pages: 0, page: 1 });
  }
  if (url.pathname === '/api/error-logs') return json({ ok: true });
  return json({});
});

// A manual local production build bakes localhost:8000 into the server-owned
// web-vitals prop. Register the loopback target explicitly: Chromium may apply
// private-network routing before the catch-all fixture sees it.
await context.route('http://localhost:8000/api/analytics/events', async (route) => {
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({
      status: 204,
      headers: {
        'access-control-allow-origin': BASE,
        'access-control-allow-methods': 'POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
      body: '',
    });
  }
  const payload = route.request().postDataJSON();
  if (payload?.event_name === 'web_vitals') vitals.push(payload.event_data);
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': BASE,
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
    body: '{"ok":true}',
  });
});

try {
await page.goto(`${BASE}/result?id=${sessionId}`, { waitUntil: 'domcontentloaded' });
await page.locator('.result-back-link').waitFor();
await page.waitForFunction(() => Boolean(window.getSupabase?.() && window.aver?.trackPageView));
await waitFor(() => analyticsPaths.includes('/result'));

const before = await page.evaluate(() => ({
  client: window.getSupabase?.()?.marker,
  creates: window.__fixtureSupabaseCreates,
  ownedBodyClasses: document.body.getAttribute('data-aver-route-body-classes'),
}));
await page.evaluate(() => { window.__clientNavigationSentinel = 'survived'; });
await page.locator('.result-back-link').click();
await page.waitForURL(`${BASE}/speaking`);
await page.locator('.speaking-hub-title').waitFor();
await waitFor(() => analyticsPaths.includes('/speaking'));

const after = await page.evaluate(() => ({
  sentinel: window.__clientNavigationSentinel,
  client: window.getSupabase?.()?.marker,
  creates: window.__fixtureSupabaseCreates,
  ownedBodyClasses: document.body.getAttribute('data-aver-route-body-classes'),
}));

check('Next Link giữ nguyên document thay vì hard reload', after.sentinel === 'survived');
check('Supabase client dùng chung sống qua soft navigation',
  before.client === 'shared-client' && after.client === 'shared-client' && after.creates === 1,
  JSON.stringify({ before, after }));
check('body class owner tồn tại trước và sau route transition',
  Boolean(before.ownedBodyClasses) && Boolean(after.ownedBodyClasses),
  JSON.stringify({ before: before.ownedBodyClasses, after: after.ownedBodyClasses }));
check('page_view ghi đủ hai pathname và không ghi trùng',
  analyticsPaths.filter((path) => path === '/result').length === 1
    && analyticsPaths.filter((path) => path === '/speaking').length === 1,
  JSON.stringify(analyticsPaths));
check('không có lỗi JavaScript chưa bắt', pageErrors.length === 0, pageErrors[0] || '');

await page.evaluate(() => { window.__chromeNavigationSentinel = 'survived'; });
await page.locator('aver-chrome a[href="/grammar"]').first().click();
await page.waitForURL(`${BASE}/grammar`);
check('student chrome dùng App Router qua Shadow DOM',
  await page.evaluate(() => window.__chromeNavigationSentinel) === 'survived');

const libraryPage = await context.newPage();
const libraryErrors = [];
libraryPage.on('pageerror', (error) => libraryErrors.push(String(error)));
await libraryPage.goto(`${BASE}/reading/vocab`, { waitUntil: 'domcontentloaded' });
await libraryPage.locator('.rv-libnav').waitFor();
await libraryPage.evaluate(() => { window.__libraryNavigationSentinel = 'survived'; });
await libraryPage.getByRole('link', { name: 'Skill Practice', exact: true }).click();
await libraryPage.waitForURL(`${BASE}/reading/skill`);
check('Reading library switcher dùng App Router',
  await libraryPage.evaluate(() => window.__libraryNavigationSentinel) === 'survived');

await libraryPage.goto(`${BASE}/listening/practice`, { waitUntil: 'domcontentloaded' });
await libraryPage.getByRole('link', { name: /Mở kho bài nghe/ }).waitFor();
await libraryPage.evaluate(() => { window.__libraryNavigationSentinel = 'survived'; });
await libraryPage.getByRole('link', { name: /Mở kho bài nghe/ }).click();
await libraryPage.waitForURL(`${BASE}/listening/browse`);
check('Listening hub CTA dùng App Router',
  await libraryPage.evaluate(() => window.__libraryNavigationSentinel) === 'survived');
check('soft navigation thư viện không phát sinh lỗi JavaScript',
  libraryErrors.length === 0, libraryErrors[0] || '');
await libraryPage.close();

const publicPage = await context.newPage();
const publicErrors = [];
publicPage.on('pageerror', (error) => publicErrors.push(String(error)));
await publicPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await publicPage.getByRole('link', { name: 'Đăng nhập', exact: true }).first().waitFor();
await publicPage.evaluate(() => { window.__publicNavigationSentinel = 'survived'; });
await publicPage.getByRole('link', { name: 'Đăng nhập', exact: true }).first().click();
await publicPage.waitForURL(`${BASE}/login`);
await publicPage.getByRole('heading', { name: 'Bắt đầu luyện tập' }).waitFor();
const publicSentinel = await publicPage.evaluate(() => window.__publicNavigationSentinel);
check('CTA public dùng App Router thay vì nạp lại document', publicSentinel === 'survived');
await publicPage.goBack();
await publicPage.waitForURL(`${BASE}/`);
check('back/forward giữ đúng URL sau soft navigation public', await publicPage.evaluate(() => window.__publicNavigationSentinel) === 'survived');
check('soft navigation public không phát sinh lỗi JavaScript', publicErrors.length === 0, publicErrors[0] || '');
await publicPage.close();

const adminPage = await context.newPage();
const adminErrors = [];
adminPage.on('pageerror', (error) => adminErrors.push(String(error)));
await adminPage.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await adminPage.locator('aver-admin-chrome a[href="/admin/users"]').first().waitFor();
await adminPage.evaluate(() => {
  window.__adminGuardCalls = 0;
  window.__adminUnsavedGuard = (event) => {
    window.__adminGuardCalls += 1;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', window.__adminUnsavedGuard);
  window.addEventListener('aver:navigation-guard', window.__adminUnsavedGuard);
  window.__adminNativeClickBlocker = (event) => event.preventDefault();
  document.querySelector('aver-admin-chrome').shadowRoot.addEventListener('click', window.__adminNativeClickBlocker);
});
await adminPage.locator('aver-admin-chrome a[href="/admin/users"]').first().click();
await adminPage.waitForTimeout(100);
check('admin chrome giữ cảnh báo trước khi rời trang có dữ liệu chưa lưu',
  new URL(adminPage.url()).pathname === '/admin'
    && await adminPage.evaluate(() => window.__adminGuardCalls) > 0);
await adminPage.evaluate(() => {
  window.removeEventListener('beforeunload', window.__adminUnsavedGuard);
  window.removeEventListener('aver:navigation-guard', window.__adminUnsavedGuard);
  document.querySelector('aver-admin-chrome').shadowRoot.removeEventListener('click', window.__adminNativeClickBlocker);
  delete window.__adminUnsavedGuard;
  delete window.__adminNativeClickBlocker;
  delete window.__adminGuardCalls;
});
await adminPage.evaluate(() => { window.__adminNavigationSentinel = 'survived'; });
await adminPage.locator('aver-admin-chrome a[href="/admin/users"]').first().click();
await adminPage.waitForURL(`${BASE}/admin/users`);
check('admin chrome dùng App Router qua Shadow DOM',
  await adminPage.evaluate(() => window.__adminNavigationSentinel) === 'survived');
check('soft navigation admin không phát sinh lỗi JavaScript', adminErrors.length === 0, adminErrors[0] || '');
await adminPage.close();
await page.close();
await waitFor(() => vitals.some((metric) => metric.metric_name === 'LCP'));
const initialLcp = vitals.find((metric) => metric.metric_name === 'LCP');
check('native LCP giữ pathname của document đầu sau soft navigation',
  initialLcp?.path === '/result' && typeof initialLcp?.lcp === 'number'
    && initialLcp?.implementation === 'next',
  JSON.stringify(initialLcp || vitals));
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.ok);
console.log(`\nShared runtime client navigation: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
