// Rendered Next layout regression. Synthetic auth/API only, including when
// measuring the deployed staging shell. No credentials or backend writes.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3188');
if (!(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  || base.origin === 'https://staging.averlearning.com')
  || base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
  throw new Error('Use a loopback Next server or the explicit staging origin');
}
const API = 'https://api.writing-layout.invalid';
const USER = '11111111-1111-4111-8111-111111111111';
const student = { full_name: 'e2e-student-qa-test-2026102901', student_code: 'LOCAL-123', target_band: 6.5 };
const widthFilter = Number(process.argv.find(arg => arg.startsWith('--width='))?.slice(8));
const evidence = process.env.LAYOUT_EVIDENCE_DIR;
// Use the same pinned Web Vitals implementation shipped with Next, with its
// attribution build. The CommonJS wrapper stays inside this test-only scope.
const vitals = readFileSync(new URL('../node_modules/next/dist/compiled/web-vitals-attribution/web-vitals.attribution.js', import.meta.url), 'utf8');
const browser = await chromium.launch();
const failures = [];
const reports = [];
const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};
async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // PerformanceObserver delivers asynchronously, independently of DOM updates.
  await page.waitForTimeout(150);
}
async function geometry(page) {
  return page.evaluate(() => Object.fromEntries(['#content', '.wd-tabs', '#assignments-list'].map(selector => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return [selector, { top: r.top, height: r.height }];
  })));
}
try {
  for (const width of [375, 390, 1280].filter(w => !widthFilter || w === widthFilter)) {
    for (const theme of ['light', 'dark']) {
      for (const kind of ['assigned', 'undated', 'empty']) {
        const context = await browser.newContext({ serviceWorkers: 'block',
          viewport: { width, height: width === 375 ? 812 : width === 390 ? 844 : 800 } });
        const reads = { assignments: gate(), essays: gate(), permissions: gate(), prompts: gate() };
        const requested = new Set(), unexpected = [], errors = [];
        await context.addInitScript({ content: `(() => { const module = { exports: {} }; const __dirname = ''; ${vitals}
          window.__writingWebVitalsCLS = { value: 0 };
          module.exports.onCLS(metric => { window.__writingWebVitalsCLS = {
            value: metric.value, target: metric.attribution?.largestShiftTarget
          }; }, { reportAllChanges: true }); })();` });
        await context.addInitScript(({ user, theme }) => {
          localStorage.setItem('av-theme', theme);
          window.__AVER_SUPABASE_CLIENT__ = { auth: {
            getSession: async () => ({ data: { session: { access_token: 'synthetic-layout-fixture',
              user: { id: user, email: 'layout@fixture.invalid' } } } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          } };
          window.__layoutShifts = [];
          new PerformanceObserver(list => {
            for (const e of list.getEntries()) if (!e.hadRecentInput) window.__layoutShifts.push({
              value: e.value, time: e.startTime, sources: e.sources.map(s => ({
                node: s.node?.id || s.node?.className || s.node?.nodeName,
                from: s.previousRect.toJSON(), to: s.currentRect.toJSON(),
              })),
            });
          }).observe({ type: 'layout-shift', buffered: true });
        }, { user: USER, theme });
        const cors = { 'access-control-allow-origin': base.origin,
          'access-control-allow-methods': 'GET,OPTIONS',
          'access-control-allow-headers': 'authorization,content-type,x-core-operation-id' };
        const json = data => ({ contentType: 'application/json', headers: cors, body: JSON.stringify(data) });
        const assignments = kind !== 'empty' ? [1, 2].map(n => ({
          id: `assignment-${n}`, assignment_group_id: 'group-1', name: 'QA TEST class Writing',
          status: 'pending', deadline: kind === 'undated' ? null : new Date(Date.now() + n * 7200000).toISOString(),
          writing_prompts: { title: `QA TEST Task ${n} — do not use`, task_type: 'task2' },
        })) : [];
        await context.route('**/*', async route => {
          const req = route.request(), url = new URL(req.url()), method = req.method();
          if (url.origin === base.origin && method === 'GET') {
            if (url.pathname === '/js/runtime-config.js') return route.fulfill({ contentType: 'application/javascript',
              body: `window.__AVER_RUNTIME_CONFIG__=Object.freeze(${JSON.stringify({ environment: 'test',
                apiBase: API, supabaseUrl: 'https://layoutfixture.supabase.co', supabaseAnonKey: 'fixture-only' })});` });
            if (url.pathname === '/writing/dashboard' || /^\/(?:_next\/|__nextjs_font\/|js\/|css\/|assets\/|vendor\/)/.test(url.pathname)
              || url.pathname.startsWith('/favicon')) return route.continue();
          }
          if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') return route.continue();
          if (url.origin === API) {
            if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
            if (method === 'GET') {
              if (url.pathname === '/auth/me') return route.fulfill(json({ id: USER, role: 'student', is_active: true }));
              if (url.pathname === '/auth/check-active') return route.fulfill(json({ is_active: true }));
              if (url.pathname === '/api/writing/my-assignments') {
                requested.add('assignments'); await reads.assignments.promise;
                return route.fulfill(json({ student: kind === 'empty' ? {} : student, assignments }));
              }
              if (url.pathname === '/api/writing/my-essays') {
                requested.add('essays'); await reads.essays.promise;
                return route.fulfill(json({ student: kind === 'empty' ? {} : student, essays: [] }));
              }
              if (url.pathname === '/api/student/permissions') {
                requested.add('permissions'); await reads.permissions.promise;
                return route.fulfill(json({ writing: true }));
              }
              if (url.pathname === '/api/writing/prompt-bank') {
                requested.add('prompts'); await reads.prompts.promise;
                return route.fulfill(json({ enabled: true, prompts: [{ id: 'prompt-1', title: 'Fixture prompt',
                  prompt_text: 'Discuss learning English.', task_type: 'task2' }] }));
              }
              if (url.pathname === '/api/writing/tips') return route.fulfill(json({ tips: [] }));
            }
          }
          // Instrumentation is intercepted too: it never reaches a backend.
          if (['/api/analytics/events', '/api/error-logs'].includes(url.pathname)) return route.fulfill({ status: 204, headers: cors });
          unexpected.push(`${method} ${url.origin}${url.pathname}`);
          return route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => errors.push(error.message));
        const name = `${width}-${theme}-${kind}`;
        console.log(`START ${name}`);
        try {
          await page.goto(new URL('/writing/dashboard', base).href, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => window.WritingSubmitReceipt && document.querySelector('.wd-tabs'));
          const requestDeadline = Date.now() + 15000;
          while (!requested.has('assignments') || !requested.has('essays')) {
            assert.ok(Date.now() < requestDeadline, 'canonical list requests started');
            await page.waitForTimeout(25);
          }
          await page.evaluate(() => document.fonts.ready);
          await frames(page);
          const before = await geometry(page);
          const dataStart = await page.evaluate(() => performance.now());
          reads.assignments.release();
          await page.locator(kind !== 'empty' ? '#assignments-list .assignment-card' : '#assignments-empty').first().waitFor();
          await frames(page);
          const afterAssignments = await geometry(page);
          reads.essays.release(); reads.permissions.release(); reads.prompts.release();
          await page.locator('#tab-prompt-bank').waitFor();
          await frames(page);
          const after = await geometry(page);
          assert.equal(await page.locator('#assignments-loading').isVisible(), false, 'loading cards clear after canonical read');
          assert.equal(await page.locator('#deadlines-surface').isVisible(), kind === 'assigned', 'deadline visibility follows canonical rows');
          assert.equal(await page.locator('#assignments-list .assignment-card').count(), kind === 'empty' ? 0 : 2);
          const shifts = await page.evaluate(() => window.__layoutShifts);
          const webVitals = await page.evaluate(() => window.__writingWebVitalsCLS);
          assert.ok(Number.isFinite(webVitals?.value), 'Web Vitals initialized and reports a numeric CLS');
          const cls = shifts.reduce((sum, s) => sum + s.value, 0);
          const dataCls = shifts.filter(s => s.time >= dataStart).reduce((sum, s) => sum + s.value, 0);
          const report = { name, cls, dataCls, webVitals, before, afterAssignments, after, shifts };
          reports.push(report);
          console.log(JSON.stringify(report));
          if (evidence) {
            mkdirSync(evidence, { recursive: true });
            await page.screenshot({ path: `${evidence}/${name}.png` });
          }
          const problems = [];
          if (webVitals.value >= 0.1) problems.push(`Web Vitals CLS ${webVitals.value} must be < 0.1`);
          if (cls >= 0.1) problems.push(`total CLS ${cls} must be < 0.1`);
          if (dataCls >= 0.1) problems.push(`data CLS ${dataCls} must be < 0.1`);
          for (const selector of ['#content', '.wd-tabs']) {
            if (Math.abs(before[selector].top - after[selector].top) > 1) problems.push(`${selector} moved vertically`);
          }
          const tabs = await page.locator('.wd-tabs').evaluate(el => ({
            overflow: el.scrollWidth > el.clientWidth + 1, hint: el.dataset.overflow,
            endGradient: getComputedStyle(el.parentElement, '::after').backgroundImage,
            endOpacity: getComputedStyle(el.parentElement, '::after').opacity,
          }));
          if (tabs.overflow && (!['end', 'both'].includes(tabs.hint) || !tabs.endGradient.includes('gradient') || tabs.endOpacity !== '1')) {
            problems.push('overflowing tabs have no visible end affordance');
          }
          // DOM click avoids Playwright's automatic scroll masking a missing
          // application scrollIntoView when selecting the clipped tab.
          const scrollY = await page.evaluate(() => window.scrollY);
          await page.locator('#tab-prompt-bank').evaluate(el => el.click());
          await page.waitForFunction(() => {
            const tab = document.querySelector('#tab-prompt-bank').getBoundingClientRect();
            const strip = document.querySelector('.wd-tabs').getBoundingClientRect();
            return tab.left >= strip.left - 1 && tab.right <= strip.right + 1;
          }, null, { timeout: 1500 }).catch(() => problems.push('selected prompt-bank tab remains clipped'));
          assert.equal(await page.evaluate(() => window.scrollY), scrollY, 'selecting a tab must preserve vertical scroll');
          if (evidence) await page.screenshot({ path: `${evidence}/${name}-prompt-bank.png` });
          if (tabs.overflow) {
            await page.waitForFunction(() => document.querySelector('.wd-tabs').dataset.overflow === 'start');
            assert.equal(await page.locator('.wd-tabs-frame').evaluate(el => getComputedStyle(el, '::before').opacity), '1');
            await page.locator('#tab-assignments').evaluate(el => el.click());
            await page.waitForFunction(() => document.querySelector('.wd-tabs').dataset.overflow === 'end');
            await page.setViewportSize({ width: 1280, height: 800 });
            await page.waitForFunction(() => document.querySelector('.wd-tabs').dataset.overflow === 'none');
            assert.equal(await page.locator('.wd-tabs-frame').evaluate(el => getComputedStyle(el, '::after').opacity), '0');
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');
          assert.deepEqual(unexpected, [], 'no unmocked requests');
          assert.deepEqual(errors, [], 'no runtime errors');
          assert.deepEqual(problems, [], name);
          console.log(`PASS ${name}`);
        } catch (error) {
          console.log(`FAIL ${name}: ${error.message}; runtime=${JSON.stringify(errors)}; unexpected=${JSON.stringify(unexpected)}`);
          failures.push(`${name}: ${error.message}`);
        }
        finally {
          Object.values(reads).forEach(read => read.release());
          await context.close();
        }
      }
    }
  }
} finally { await browser.close(); }
if (evidence) writeFileSync(`${evidence}/measurements.json`, JSON.stringify(reports, null, 2));
assert.deepEqual(failures, []);
console.log(`PASS Writing dashboard layout: ${reports.length} viewport/theme/account cases`);
