// Q-82 browser regression: staff must get the avatar-menu "Trang giảng viên"
// link however the chrome's own session read and the page's setUser({name})
// interleave. CI run 40630894114 lost it for an admin at 390px when /home's
// home-summary called setUser() before the chrome finished getSession(): the
// page-owned pill flag also cancelled the chrome's /auth/me role lookup. This
// verifier makes each interleaving deterministic with an artificial delay.
// Learners must still never carry the anchor (Q-40). Auth and every API read
// are fixture-backed; no request leaves the browser and nothing is written.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3000';
const API = 'https://api.chrome-staff-link.invalid';
const WIDTHS = [390, 1280];
const ROLES = [['user', false], ['instructor', true], ['admin', true]];
// The chrome's getSession() is held until /home has rendered its hero, so the
// page's setUser({name}) (same task as the hero render) always lands first:
// the CI interleaving, made deterministic. Separately, the role response
// itself is slow.
const DELAYS = [
  { name: 'chrome getSession after page setUser', holdSession: true, authMeMs: 0 },
  { name: '/auth/me +1500ms', holdSession: false, authMeMs: 1500 },
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

// The hold applies only to calls made from aver-chrome.js; the page's
// AuthProvider and api.js read the session immediately.
const supabaseStub = (holdSession) => `
window.__Q82_CHROME_SESSION_READS__ = 0;
window.__AVER_SUPABASE_CLIENT__ = { auth: {
  getSession: async function () {
    var fromChrome = String(new Error().stack).indexOf('/js/components/aver-chrome.js') !== -1;
    if (fromChrome && ${holdSession}) {
      var until = Date.now() + 5000;
      while (Date.now() < until) {
        var hero = document.querySelector('#hero-essays .value-num');
        if (hero && hero.textContent === '0') break;
        await new Promise(function (r) { setTimeout(r, 20); });
      }
    }
    if (fromChrome) window.__Q82_CHROME_SESSION_READS__ += 1;
    return { data: { session: { access_token: 'fixture-token', user: { id: 'q82', email: 'q82@example.test', user_metadata: { display_name: 'Vinh Tran' } } } }, error: null };
  },
  onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} };`;

async function openHome(browser, width, role, delay) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript({ content: supabaseStub(delay.holdSession) });
  const authMe = { requests: 0, answered: 0 };
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
      status: 200, contentType: 'application/json', headers, body: JSON.stringify(body),
    });
    if (url.pathname === '/auth/me') {
      authMe.requests += 1;
      if (delay.authMeMs) await new Promise((r) => setTimeout(r, delay.authMeMs));
      await json({ id: 'q82', email: 'q82@example.test', display_name: 'Vinh Tran', role, is_active: true, onboarding_completed: true });
      authMe.answered += 1;
      return undefined;
    }
    if (url.pathname === '/api/student/home-summary') {
      return json({ student: { name: 'Vinh Tran' }, streak: { current_days: 2 }, totals: { speaking_sessions: 0, writing_essays: 0 }, skills: {} });
    }
    if (url.pathname === '/api/class/me') return json({ has_class: false });
    if (url.pathname.includes('assignments') || url.pathname.includes('sessions')) return json([]);
    return json({});
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  // The page has called setUser({name}) once the hero renders. Whether the
  // chrome then reads the session is part of what is checked below.
  await page.waitForFunction(() => {
    const name = document.querySelector('aver-chrome')?.shadowRoot?.getElementById('user-pill-name');
    return name?.textContent === 'Vinh Tran'
      && document.querySelector('#hero-essays .value-num')?.textContent === '0';
  }, null, { timeout: 10_000 });
  return { context, page, authMe };
}

const browser = await launch();
try {
  for (const delay of DELAYS) {
    for (const width of WIDTHS) {
      for (const [role, expected] of ROLES) {
        const { context, page, authMe } = await openHome(browser, width, role, delay);
        const chrome = page.locator('aver-chrome');
        await chrome.locator('#user-pill').click();
        const read = () => chrome.evaluate((host) => {
          const anchors = [...host.shadowRoot.querySelectorAll('#instructor-link, a[href="/instructor"]')];
          const a = anchors[0];
          return {
            count: anchors.length,
            display: a ? getComputedStyle(a).display : 'absent',
            width: a ? a.getBoundingClientRect().width : 0,
          };
        });
        // The role is known once the chrome's /auth/me has been answered;
        // give it the delay plus 2s, then read the menu.
        const deadline = Date.now() + delay.authMeMs + 2000;
        while (authMe.answered === 0 && Date.now() < deadline) await page.waitForTimeout(50);
        await page.waitForTimeout(200);
        const state = await read();
        const label = `${delay.name}, ${width}px ${role}`;
        const sessionReads = await page.evaluate(() => window.__Q82_CHROME_SESSION_READS__);
        check(`${label}: chrome resolved the role with one /auth/me`,
          authMe.requests === 1 && authMe.answered === 1,
          `requests ${authMe.requests}, chrome session reads ${sessionReads}`);
        check(`${label}: "Trang giảng viên" ${expected ? 'shown' : 'absent from DOM'}`,
          expected ? state.count === 1 && state.display !== 'none' && state.width > 0 : state.count === 0,
          `anchors ${state.count}, display ${state.display}`);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`✗ ${failed.length}/${results.length} staff-link race checks failed`);
  process.exitCode = 1;
} else {
  console.log(`✓ ${results.length} staff-link race checks across ${DELAYS.length} delays`);
}
