// U-20 browser regression: the signed-in <aver-chrome> nav must never wrap to
// several rows and /home must never scroll sideways between the phone and
// desktop layouts. At 721px the eight-link row used to wrap to three rows and
// the hero stats widened the page by ~13px. Auth and every API read are
// fixture-backed; no request leaves the browser and nothing is written.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3000';
const API = 'https://api.chrome-nav-width.invalid';
// The hamburger owns <=1024.98px; 1025-1279.98px is the compact single row;
// 1280px is the untouched desktop layout.
const WIDTHS = [720, 721, 800, 900, 1024, 1025, 1100, 1279, 1280];
const HAMBURGER_MAX = 1024;
// U-12: the avatar dropdown's "Trang giảng viên" link must follow the
// /auth/me role at both the desktop and phone layouts.
const ROLE_WIDTHS = [1280, 390];
const ROLES = [['user', false], ['instructor', true], ['admin', true]];
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

// A real-length display name: the pill used to wrap "Vinh Tran" to two lines.
const supabaseStub = `
window.__AVER_SUPABASE_CLIENT__ = { auth: {
  getSession: async function () { return { data: { session: { access_token: 'fixture-token', user: { id: 'u20', email: 'u20@example.test', user_metadata: { display_name: 'Vinh Tran' } } } }, error: null }; },
  onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} };`;

async function openHome(browser, width, role = 'user') {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript({ content: supabaseStub });
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
      return json({ id: 'u20', email: 'u20@example.test', display_name: 'Vinh Tran', role, is_active: true, onboarding_completed: true });
    }
    if (url.pathname === '/api/student/home-summary') {
      // Mirrors the audited staging account: streak 2, zero Speaking/Writing.
      return json({ student: { name: 'Vinh Tran' }, streak: { current_days: 2 }, totals: { speaking_sessions: 0, writing_essays: 0 }, skills: {} });
    }
    if (url.pathname === '/api/class/me') return json({ has_class: false });
    if (url.pathname.includes('assignments') || url.pathname.includes('sessions')) return json([]);
    return json({});
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  // Measure only after the signed-in pill name and the hero numbers render.
  await page.waitForFunction(() => {
    const name = document.querySelector('aver-chrome')?.shadowRoot?.getElementById('user-pill-name');
    return name?.textContent === 'Vinh Tran'
      && document.querySelector('#hero-essays .value-num')?.textContent === '0';
  }, null, { timeout: 10_000 });
  return { context, page };
}

function measure(page) {
  return page.evaluate(() => {
    const root = document.querySelector('aver-chrome').shadowRoot;
    const links = [...root.querySelectorAll('.nav-links a')];
    const toggle = root.getElementById('mobile-nav-toggle');
    const pillName = root.getElementById('user-pill-name');
    const rect = (el) => el.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      hamburger: getComputedStyle(toggle).display !== 'none' && rect(toggle).width > 0,
      linksVisible: links.filter((a) => rect(a).width > 0).length,
      linkTops: [...new Set(links.map((a) => Math.round(rect(a).top)))],
      linksHeight: rect(root.querySelector('.nav-links')).height,
      tallestLink: Math.max(...links.map((a) => rect(a).height)),
      // The name span is a blockified flex item; count its text's line boxes.
      pillNameLines: (() => {
        const range = document.createRange();
        range.selectNodeContents(pillName);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      })(),
    };
  });
}

const browser = await launch();
try {
  for (const width of WIDTHS) {
    const { context, page } = await openHome(browser, width);
    const m = await measure(page);
    check(`${width}px: no horizontal scroll`, m.scrollWidth <= m.innerWidth,
      `scrollWidth ${m.scrollWidth} vs innerWidth ${m.innerWidth}`);
    const singleRow = m.linksVisible === 8 && m.linkTops.length === 1
      && m.linksHeight <= m.tallestLink + 1 && m.pillNameLines <= 1;
    check(`${width}px: nav is one row or behind the hamburger`, m.hamburger
      ? m.linksVisible === 0
      : singleRow,
    m.hamburger ? `hamburger, ${m.linksVisible} visible links`
      : `${m.linkTops.length} link row(s), pill name ${m.pillNameLines} line(s)`);
    check(`${width}px: hamburger only at <=${HAMBURGER_MAX}px`, m.hamburger === (width <= HAMBURGER_MAX));

    // U-01 disclosure must keep working in the widened tablet range.
    if (width === 900) {
      const toggle = page.locator('aver-chrome #mobile-nav-toggle');
      const menu = page.locator('aver-chrome .nav-links');
      await toggle.focus();
      await page.keyboard.press('Enter');
      const opened = await toggle.getAttribute('aria-expanded') === 'true'
        && await menu.getByRole('link').count() === 8
        && await menu.getByRole('link', { name: 'Trang chủ', exact: true }).getAttribute('aria-current') === 'page';
      const heights = await menu.getByRole('link').evaluateAll(
        (links) => links.map((a) => a.getBoundingClientRect().height),
      );
      check('900px: disclosure opens all eight links with 44px targets',
        opened && heights.every((h) => h >= 44), heights.map(Math.round).join(','));
      const openScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      check('900px: open menu adds no horizontal scroll', openScroll);
      await page.keyboard.press('Escape');
      const closed = !(await menu.isVisible())
        && await toggle.evaluate((el) => el.getRootNode().activeElement === el);
      check('900px: Escape closes the menu and restores toggle focus', closed);
    }
    await context.close();
  }

  for (const width of ROLE_WIDTHS) {
    for (const [role, expected] of ROLES) {
      const { context, page } = await openHome(browser, width, role);
      const chrome = page.locator('aver-chrome');
      await chrome.locator('#user-pill').click();
      // Q-40: a learner's menu must not carry the anchor at all (not merely
      // hide it), so read every /instructor anchor in the shadow root.
      const read = () => chrome.evaluate((host) => {
        const anchors = [...host.shadowRoot.querySelectorAll('#instructor-link, a[href="/instructor"]')];
        const a = anchors[0];
        return {
          count: anchors.length,
          display: a ? getComputedStyle(a).display : 'absent',
          width: a ? a.getBoundingClientRect().width : 0,
        };
      });
      // The chrome applies the /auth/me role asynchronously: wait for the
      // insert on staff roles, and give a student the same window to leak.
      const ok = (st) => (expected
        ? st.count === 1 && st.display !== 'none' && st.width > 0
        : st.count === 0);
      let state = await read();
      for (let i = 0; i < 20 && !ok(state); i += 1) {
        await page.waitForTimeout(100);
        state = await read();
      }
      if (!expected) { await page.waitForTimeout(500); state = await read(); }
      check(`${width}px ${role}: "Trang giảng viên" ${expected ? 'shown' : 'absent from DOM'}`,
        ok(state), `anchors ${state.count}, display ${state.display}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`✗ ${failed.length}/${results.length} chrome width checks failed`);
  process.exitCode = 1;
} else {
  console.log(`✓ ${results.length} chrome width + role checks across ${WIDTHS.length + ROLE_WIDTHS.length} viewports`);
}
