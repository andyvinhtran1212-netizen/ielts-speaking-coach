// Hermetic browser regression for G-01: guarded learner routes boot only once
// signed in, and never show content or an error box before the signed-out
// /login redirect.
//
// The bug: a direct load of /grammar-checkup called window.api.get on mount,
// but api.js is chained in by the runtime boundary AFTER hydration, so the
// learner saw "Cannot read properties of undefined (reading 'get')". api.js is
// delayed here so the race is deterministic, not timing luck.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3000';
const api = new URL(process.env.AVER_API_BASE || 'http://127.0.0.1:3999');
if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname)
    || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
  throw new Error('AVER_API_BASE must be an explicit local fixture origin');
}
const API = api.origin;
const USER = '00000000-0000-4000-8000-000000000501';
const API_JS_DELAY_MS = 1_500;

// Route-specific markers of real content or an error box. None of them exists
// on /login, so seeing one on a signed-out visit means it flashed pre-redirect.
const PRIVATE_MARKERS = ['.gd-error', '.gd-setup', '.gd-question', '.gd-report-hero', '.vx-family', '.vx-status.is-error', '.avx-hero', '.avx-state h1'];

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

async function newContext(browser, { signedIn }) {
  // The production build owns its CSP. This verifier owns every request and
  // supplies a loopback-only runtime config, like the other native verifiers.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
  const session = signedIn
    ? `{ access_token: 'fixture-token', user: { id: '${USER}', email: 'learner@local' } }`
    : 'null';
  await context.addInitScript({ content: `
window.__AVER_SUPABASE_CLIENT__ = { auth: {
  getSession: async function () { return { data: { session: ${session} }, error: null }; },
  onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} };
(function () {
  var markers = ${JSON.stringify(PRIVATE_MARKERS)};
  function record() {
    var seen = JSON.parse(sessionStorage.getItem('g01-seen') || '[]');
    var changed = false;
    markers.forEach(function (selector) {
      var hit = location.pathname + ' ' + selector;
      if (document.querySelector(selector) && seen.indexOf(hit) < 0) { seen.push(hit); changed = true; }
    });
    if (changed) sessionStorage.setItem('g01-seen', JSON.stringify(seen));
  }
  new MutationObserver(record).observe(document, { childList: true, subtree: true });
})();
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
    if (url.origin === BASE && url.pathname === '/js/api.js') {
      await new Promise((resolve) => setTimeout(resolve, API_JS_DELAY_MS));
      return route.continue();
    }
    if (url.origin === BASE) return route.continue();
    if (url.origin !== API) return route.abort();
    requests.push(`${request.method()} ${url.pathname}`);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,x-request-id' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    if (url.pathname === '/auth/me') return json({ id: USER });
    if (request.method() === 'GET' && url.pathname === '/api/grammar/diagnostics/availability') return json({ assigned_only: false });
    if (request.method() === 'GET' && url.pathname === '/api/vocabulary/exam') {
      return json([{ family: 'awl', title: 'AWL', lists: [{ slug: 'awl-1', title: 'AWL Sublist 1', count: 60 }] }]);
    }
    return json({ detail: 'No fixture for this request' }, 404);
  });
  return { context, requests };
}

const seen = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('g01-seen') || '[]'));
const bodyText = async (page) => (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 800);

const browser = await launch();
try {
  // 1. Signed-in direct load: boots once, after api.js, with no error box.
  {
    const { context, requests } = await newContext(browser, { signedIn: true });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${BASE}/grammar-checkup`);
    try {
      await page.getByRole('heading', { name: 'Grammar Diagnostic & Adaptive Review' }).waitFor({ timeout: 15_000 });
    } catch (error) {
      throw new Error(`/grammar-checkup did not boot (requests=${requests.join(', ') || 'none'}, pageErrors=${pageErrors.join(' | ') || 'none'}, body=${await bodyText(page)})`, { cause: error });
    }
    await page.waitForTimeout(500);
    const errorBoxes = (await seen(page)).filter((hit) => hit.endsWith('.gd-error'));
    if (errorBoxes.length) throw new Error(`/grammar-checkup flashed its error box: ${errorBoxes.join(', ')}`);
    const boots = requests.filter((entry) => entry === 'GET /api/grammar/diagnostics/availability').length;
    if (boots !== 1) throw new Error(`/grammar-checkup booted ${boots} times (requests=${requests.join(', ')})`);
    if (pageErrors.length) throw new Error(`/grammar-checkup page errors: ${pageErrors.join(' | ')}`);
    await context.close();
  }

  // 2. Signed-out: every guarded route shows nothing private and lands on /login.
  for (const path of [
    '/grammar-checkup',
    '/grammar-checkup/review/R1',
    '/vocabulary/exam',
    '/advanced-vocabulary',
    '/course-exercises',
  ]) {
    const { context, requests } = await newContext(browser, { signedIn: false });
    const page = await context.newPage();
    await page.goto(`${BASE}${path}`);
    try {
      await page.waitForURL((url) => url.pathname === '/login', { timeout: 15_000 });
    } catch (error) {
      throw new Error(`${path} did not redirect signed-out visitors (url=${page.url()}, body=${await bodyText(page)})`, { cause: error });
    }
    const flashed = await seen(page);
    if (flashed.length) throw new Error(`${path} rendered private content before /login: ${flashed.join(', ')}`);
    // Page-view beacons are anonymous by design; anything else is a data read.
    const privateCalls = requests.filter((entry) => !/^OPTIONS |^GET \/auth\/me$|^POST \/api\/analytics\//.test(entry));
    if (privateCalls.length) throw new Error(`${path} called the API while signed out: ${privateCalls.join(', ')}`);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log('learner route auth boot: signed-in boots once after api.js; signed-out shows nothing and redirects ✓');
