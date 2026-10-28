// PC-J06 browser regression (U-21 / U-15 / U-06): the student header must not
// wait for the Supabase runtime chain (runtime-config → client → api.js). On
// slow phones that chain took 4–8s, so /home, /my-class, /speaking, /exam and
// /full-test showed no header and a dead hamburger. Here api.js is held back
// on purpose: the header and hamburger must work within 1s of
// DOMContentLoaded while the runtime is still pending, and the account pill
// fills once api.js is released. A guest on the public Grammar Wiki must not
// see the "·" / "…" account placeholder. Auth and every API read are
// fixture-backed; no request leaves the browser and nothing is written.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3000';
const API = 'https://api.chrome-early-render.invalid';
const AUTHED = ['/home', '/my-class', '/speaking', '/exam', '/full-test'];
const WIDTHS = [390, 1280];
const HEADER_BUDGET_MS = 1000;
const PRODUCTION_ORIGINS = [
  'https://ielts-speaking-coach-production.up.railway.app',
  'https://huwsmtubwulikhlmcirx.supabase.co',
];
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

const supabaseStub = (signedIn) => `
window.__AVER_SUPABASE_CLIENT__ = { auth: {
  getSession: async function () { return { data: { session: ${signedIn
    ? "{ access_token: 'fixture-token', user: { id: 'j06', email: 'j06@example.test', user_metadata: { display_name: 'Vinh Tran' } } }"
    : 'null'} }, error: null }; },
  onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} };`;

async function openHeld(browser, path, width, signedIn) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript({ content: supabaseStub(signedIn) });
  let release;
  const apiHeld = new Promise((resolve) => { release = resolve; });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === BASE) {
      if (url.pathname === '/js/runtime-config.js') {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze({apiBase:${JSON.stringify(API)},supabaseUrl:'https://example.supabase.co'});`,
        });
      }
      if (url.pathname === '/js/api.js') await apiHeld;
      return route.continue();
    }
    if (url.origin !== new URL(API).origin) return route.abort();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,x-request-id',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const json = (body) => route.fulfill({
      status: 200, contentType: 'application/json', headers, body: JSON.stringify(body),
    });
    if (url.pathname === '/auth/check-active') return json({ is_active: true });
    if (url.pathname === '/auth/me') {
      return json({ id: 'j06', email: 'j06@example.test', display_name: 'Vinh Tran', role: 'user', is_active: true, onboarding_completed: true });
    }
    // /home and /speaking pass the page's own name to setUser().
    if (url.pathname === '/api/student/home-summary') return json({ student: { name: 'Vinh Tran' }, totals: {}, skills: {} });
    if (url.pathname === '/api/class/me') return json({ has_class: false });
    if (url.pathname.includes('assignments') || url.pathname.includes('sessions')) return json([]);
    return json({});
  });
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  return { context, page, release };
}

const headerState = (page) => page.evaluate((prod) => {
  const host = document.querySelector('aver-chrome');
  const root = host?.shadowRoot;
  const nav = root?.querySelector('.topnav');
  const menu = root?.querySelector('.user-menu');
  return {
    visible: Boolean(nav && nav.getBoundingClientRect().height > 0),
    runtimePending: typeof window.getSupabase !== 'function' || !window.getSupabase(),
    menuHidden: Boolean(menu?.hidden),
    pill: root?.getElementById('user-pill-name')?.textContent ?? null,
    prodHints: [...document.head.querySelectorAll('link[rel="preconnect"], link[rel="dns-prefetch"]')]
      .map((link) => link.getAttribute('href')).filter((href) => prod.includes(href)),
  };
}, PRODUCTION_ORIGINS);

const browser = await launch();
try {
  for (const width of WIDTHS) {
    for (const path of AUTHED) {
      const { context, page, release } = await openHeld(browser, path, width, true);
      const started = Date.now();
      let state = await headerState(page);
      while (!state.visible && Date.now() - started < HEADER_BUDGET_MS) {
        await page.waitForTimeout(25);
        state = await headerState(page);
      }
      const elapsed = Date.now() - started;
      check(`${width}px ${path}: header within ${HEADER_BUDGET_MS}ms while api.js is still pending`,
        state.visible && state.runtimePending, `${elapsed}ms, runtime pending ${state.runtimePending}`);
      check(`${width}px ${path}: no production preconnect before the runtime`, state.prodHints.length === 0,
        state.prodHints.join(',') || 'none');

      if (width < 1025) {
        const toggle = page.locator('aver-chrome #mobile-nav-toggle');
        const clicked = await toggle.click({ timeout: 2_000 }).then(() => true, () => false);
        const opened = clicked && await toggle.getAttribute('aria-expanded') === 'true'
          && await page.locator('aver-chrome .nav-links').getByRole('link').count() === 8
          && await page.locator('aver-chrome .nav-links').isVisible();
        const pending = (await headerState(page)).runtimePending;
        check(`${width}px ${path}: hamburger opens before the runtime is ready`, opened && pending);
        await page.keyboard.press('Escape');
      }

      release();
      const filled = await page.waitForFunction(() => document.querySelector('aver-chrome')
        ?.shadowRoot?.getElementById('user-pill-name')?.textContent === 'Vinh Tran',
      null, { timeout: 10_000 }).then(() => true, () => false);
      const after = await headerState(page);
      check(`${width}px ${path}: account pill fills after api.js arrives`, filled && !after.menuHidden,
        `pill «${after.pill}»`);
      await context.close();
    }

    const guest = await openHeld(browser, '/grammar', width, false);
    await guest.page.waitForFunction(() => document.querySelector('aver-chrome')?.shadowRoot?.querySelector('.topnav'),
      null, { timeout: HEADER_BUDGET_MS }).catch(() => {});
    const early = await headerState(guest.page);
    guest.release();
    await guest.page.waitForFunction(() => typeof window.getSupabase === 'function' && window.getSupabase(),
      null, { timeout: 10_000 }).catch(() => {});
    await guest.page.waitForTimeout(300);
    const late = await headerState(guest.page);
    const pillShown = await guest.page.locator('aver-chrome #user-pill').isVisible().catch(() => false);
    check(`${width}px /grammar guest: no account placeholder before or after the session check`,
      early.visible && early.menuHidden && late.menuHidden && !pillShown,
      `before hidden ${early.menuHidden}, after hidden ${late.menuHidden}`);
    await guest.context.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`✗ ${failed.length}/${results.length} early chrome checks failed`);
  process.exitCode = 1;
} else {
  console.log(`✓ ${results.length} early chrome checks across ${AUTHED.length + 1} routes × ${WIDTHS.length} widths`);
}
