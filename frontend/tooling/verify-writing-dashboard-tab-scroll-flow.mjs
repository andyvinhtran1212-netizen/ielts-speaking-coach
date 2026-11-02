// PC-J431 rendered Next regression: revealing the active Writing tab must never
// move the learner's page. Synthetic auth/read fixtures only; no live backend.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3188');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Loopback Next origin required');
const API = 'https://api.writing-tab-scroll.invalid', USER = '11111111-1111-4111-8111-111111111111';
const tips = Array.from({ length: 30 }, (_, i) => ({ id: `scroll-tip-${i}`, title: `Scroll tip ${i}`,
  body_markdown: 'Synthetic tip body.', task_type: 'task_2', content_type: 'tip', type_data: {} }));
const prompts = Array.from({ length: 8 }, (_, i) => ({ id: `scroll-prompt-${i}`, title: `Scroll prompt ${i}`,
  prompt_text: 'Discuss learning English.', task_type: 'task2' }));
const browser = await chromium.launch();
const failures = [];
let cases = 0;
async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(150);
}
try {
  for (const [width, height] of [[375, 812], [1280, 800]]) {
    for (const theme of ['light', 'dark']) {
      const name = `${width}-${theme}`;
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height } });
      const unexpected = [], errors = [];
      let tipReads = 0;
      await context.addInitScript(({ user, theme }) => {
        localStorage.setItem('av-theme', theme);
        window.__AVER_SUPABASE_CLIENT__ = { auth: {
          getSession: async () => ({ data: { session: { access_token: 'synthetic-tab-scroll',
            user: { id: user, email: 'tab-scroll@fixture.invalid' } } } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        } };
        // A tab-strip scrollIntoView also scrolls every ancestor, the page included.
        window.__tabStripReveals = [];
        const native = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (arg) {
          if (this.closest?.('.wd-tabs')) window.__tabStripReveals.push(this.id || this.className);
          return native.call(this, arg);
        };
      }, { user: USER, theme });
      const cors = { 'access-control-allow-origin': base.origin, 'access-control-allow-methods': 'GET,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type,x-core-operation-id' };
      const json = data => ({ contentType: 'application/json', headers: cors, body: JSON.stringify(data) });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url()), method = req.method();
        if (url.origin === base.origin && method === 'GET') {
          if (url.pathname === '/js/runtime-config.js') return route.fulfill({ contentType: 'application/javascript',
            body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze(${JSON.stringify({ environment: 'test',
              apiBase: API, supabaseUrl: 'https://tabscrollfixture.supabase.co', supabaseAnonKey: 'fixture-only' })});` });
          if (url.pathname === '/writing/dashboard' || /^\/(?:_next\/|__nextjs_font\/|js\/|css\/|assets\/|vendor\/)/.test(url.pathname)
            || url.pathname.startsWith('/favicon')) return route.continue();
        }
        if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') return route.continue();
        if (url.origin === API) {
          if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
          if (method === 'GET') {
            if (url.pathname === '/auth/me') return route.fulfill(json({ id: USER, role: 'student', is_active: true }));
            if (url.pathname === '/auth/check-active') return route.fulfill(json({ is_active: true }));
            if (url.pathname === '/api/writing/my-assignments') return route.fulfill(json({ student: {}, assignments: [] }));
            if (url.pathname === '/api/writing/my-essays') return route.fulfill(json({ student: {}, essays: [] }));
            if (url.pathname === '/api/student/permissions') return route.fulfill(json({ writing: true }));
            if (url.pathname === '/api/writing/prompt-bank') return route.fulfill(json({ enabled: true, prompts }));
            if (url.pathname === '/api/writing/tips') { tipReads++; return route.fulfill(json({ tips })); }
          }
        }
        if (['/api/analytics/events', '/api/error-logs'].includes(url.pathname)) return route.fulfill({ status: 204, headers: cors });
        unexpected.push(`${method} ${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      const modal = page.locator('#tip-modal');
      const scrollY = () => page.evaluate(() => window.scrollY);
      // A canonical tips read follows every library reconcile; wait for it.
      const settled = async reads => {
        const deadline = Date.now() + 15000;
        while (tipReads < reads) { assert.ok(Date.now() < deadline, 'reconcile re-read the tips list'); await page.waitForTimeout(25); }
        await page.locator('#tips-list [data-tip-id]').first().waitFor();
        await frames(page);
      };
      // Scroll so the tab strip is entirely above the viewport, then return a
      // card fully inside the viewport for a DOM click (no Playwright scroll).
      const scrollBelowTabs = async () => {
        const target = await page.evaluate(() => {
          const strip = document.querySelector('.wd-tabs').getBoundingClientRect();
          return Math.round(window.scrollY + strip.bottom + 120);
        });
        await page.evaluate(y => window.scrollTo(0, y), target);
        await frames(page);
        const at = await scrollY();
        const stripBottom = await page.locator('.wd-tabs').evaluate(el => el.getBoundingClientRect().bottom);
        assert.ok(at > 0 && Math.abs(at - target) <= 1 && stripBottom < 0,
          `page tall enough to scroll the tab strip out of view (target=${target} scrollY=${at} stripBottom=${stripBottom})`);
        await page.evaluate(() => { window.__tabStripReveals = []; });
        return at;
      };
      const visibleCard = () => page.evaluate(() => Array.from(document.querySelectorAll('#tips-list [data-tip-id]'))
        .find(card => { const r = card.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })?.getAttribute('data-tip-id'));
      const openCard = async () => {
        const id = await visibleCard();
        assert.ok(id, 'a tip card is fully visible below the tab strip');
        await page.locator(`[data-tip-id="${id}"]`).evaluate(el => el.click());
        await modal.waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.getElementById('tip-modal')?.dataset.contentState === 'ready');
        await frames(page);
      };
      const measures = {};
      const expectKept = (label, before, after, problems) => {
        measures[label] = { before, after };
        if (Math.abs(after - before) > 1) problems.push(`${label}: scrollY ${before} -> ${after}`);
      };
      console.log(`START ${name}`);
      try {
        const problems = [];
        await page.goto(new URL('/writing/dashboard?tab=tips', base).href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.WritingSubmitReceipt && document.querySelector('.wd-tabs'));
        await settled(1);
        await page.evaluate(() => document.fonts.ready);

        // (a) Popstate reconcile while the learner reads below the tab strip.
        let before = await scrollBelowTabs(), reads = tipReads;
        await page.evaluate(() => { history.pushState(history.state, '', location.href); history.back(); });
        await settled(reads + 1);
        expectKept('a-popstate-reconcile', before, await scrollY(), problems);

        // (c) Open a card, then close it normally (owned marker -> history.back).
        before = await scrollBelowTabs();
        await openCard();
        expectKept('c-open-behind-modal', before, await scrollY(), problems);
        reads = tipReads;
        await page.locator('#tip-modal-close').evaluate(el => el.click());
        await modal.waitFor({ state: 'hidden' });
        await settled(reads + 1);
        expectKept('c-normal-close', before, await scrollY(), problems);

        // (b) Open a card, damage the library marker, close via the fallback
        // replacement branch (no owned marker, so no stored scroll to restore).
        before = await scrollBelowTabs();
        await openCard();
        expectKept('b-open-behind-modal', before, await scrollY(), problems);
        await page.evaluate(() => {
          const state = { ...history.state };
          delete state.averWritingLibraryV1;
          history.replaceState(state, '', location.href);
        });
        await page.locator('#tip-modal-close').evaluate(el => el.click());
        await modal.waitFor({ state: 'hidden' });
        await frames(page);
        assert.ok(page.url().endsWith('?tab=tips'), 'fallback close replaces with the library URL');
        expectKept('b-fallback-close', before, await scrollY(), problems);

        const reveals = await page.evaluate(() => window.__tabStripReveals);
        if (reveals.length) problems.push(`tab-strip scrollIntoView called: ${JSON.stringify(reveals)}`);

        // The selected tab is still revealed inside the strip without page overflow.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator('#tab-prompt-bank').evaluate(el => el.click());
        await page.waitForFunction(() => {
          const tab = document.querySelector('#tab-prompt-bank').getBoundingClientRect();
          const strip = document.querySelector('.wd-tabs').getBoundingClientRect();
          return tab.left >= strip.left - 1 && tab.right <= strip.right + 1;
        }, null, { timeout: 1500 }).catch(() => problems.push('selected prompt-bank tab remains clipped'));
        assert.equal(await scrollY(), 0, 'selecting a tab must preserve vertical scroll');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');

        assert.deepEqual(unexpected, [], 'no unmocked requests');
        assert.deepEqual(errors, [], 'no runtime errors');
        assert.deepEqual(problems, [], name);
        cases++;
        console.log(`PASS ${name}`);
      } catch (error) {
        console.log(`FAIL ${name}: ${error.message}; runtime=${JSON.stringify(errors)}; unexpected=${JSON.stringify(unexpected)}`);
        failures.push(`${name}: ${error.message}`);
      } finally {
        console.log(JSON.stringify({ name, measures }));
        await context.close();
      }
    }
  }
} finally { await browser.close(); }
assert.deepEqual(failures, []);
console.log(`PASS Writing dashboard tab reveal keeps scroll: ${cases} viewport/theme cases`);
