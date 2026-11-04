// PC-J566 / SEC-CSP-NONCE, fix (b) of SA-1029-CSP1 F1: 404s under the
// signed-in prefixes. Next answers a URL no route matches with the prerendered
// root not-found page, whose scripts cannot carry a request nonce, so the
// proxy leaves those URLs on the public baseline. It decides from the build's
// own route table (tooling/nonce-route-table.mjs), never from request headers
// or a "404" in the URL.
//
// Against a real `next build` + `next start`:
//   1. the proxy's route table equals the compiled .next/routes-manifest.json
//      under the nonce prefixes, and no rewrite adds a route there;
//   2. real signed-in routes: one nonce policy, every <script> carries it, a
//      fresh nonce per request;
//   3. signed-in 404s (and the /nope-top-level, /login/nope-xyz controls):
//      HTTP 404, exactly the public baseline (no nonce, no Report-Only), the
//      404 card in the server HTML, then Chromium: React hydrated and 0
//      `securitypolicyviolation` events / console CSP messages;
//   4. path confusion and forged routing headers: a 200 always has the nonce
//      policy, a 404 always the baseline, sent with the raw path;
//   5. notFound() from a request-time page, inside <Suspense> (80-days) and
//      outside it (test fixture tests/fixtures/csp-not-found-probe, which CI
//      copies into app/ before this build): never a nonce header over
//      unstamped scripts, 0 violations; the HTTP status is printed.
// CSP is not bypassed.
//
//   node tooling/verify-csp-nonce-404-flow.mjs http://localhost:3000             # Report-Only build
//   node tooling/verify-csp-nonce-404-flow.mjs --enforced http://localhost:3000  # AVER_CSP_NONCE_ENFORCE=1 build (CI)
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { auditNonceResponse, auditNonceRoute } from './check-csp-nonce-deployed.mjs';
import { nonceRouteAllowed } from './content-security-policy.mjs';
import { collectNonceRoutes } from './nonce-route-table.mjs';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const enforced = args.includes('--enforced');
const BASE = args.find((arg) => arg !== '--enforced') || 'http://localhost:3000';
const api = new URL(process.env.AVER_API_BASE || 'http://127.0.0.1:3999');
if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(api.hostname)) {
  throw new Error('AVER_API_BASE must be an explicit local fixture origin');
}
const API = api.origin;
const USER = '00000000-0000-4000-8000-000000000566';
const CARD = '404 · Không tìm thấy';
const BASELINE_SCRIPT = /(^|; )script-src 'self' 'unsafe-inline'(;| |$)/;

const REAL_ROUTES = ['/home', '/admin', '/profile', '/vocabulary/hub', '/instructor'];
const NOT_FOUND = [
  // a. a signed-in prefix with no index page; b. nested; c. admin, instructor.
  '/practice', '/home/does-not-exist', '/vocabulary/nope/xyz/abc', '/admin/nope-xyz', '/instructor/nope-xyz',
  // Public controls. /login is outside the proxy matcher (SA-1029-CSP1 F1).
  '/nope-top-level', '/login/nope-xyz',
];
// Raw request paths (node:http does not normalize them the way fetch does).
const CONFUSION = [
  '/admin/404', '/home/404', '/404/x', '/admin/_not-found', '/admin?x=/404', '/admin/%2e%2e/404',
  '/admin/%2E%2E/admin', '/admin/../home', '/admin/cl%61sses', '/admin/%zz', '/h%6fme', '/HOME',
  '/admin/classes/abc', '/admin/classes/a%2Fb', '/reading/vocab/x%2Fy', '/listening/ielts/80-d%61ys/5',
];
const FORGED = [
  { 'x-matched-path': '/404' }, { 'x-invoke-status': '404' }, { 'x-invoke-path': '/_not-found' },
  { 'x-nextjs-data': '1' }, { 'x-now-route-matches': '1' },
  { 'x-middleware-subrequest': 'proxy:proxy:proxy:proxy:proxy' },
  { 'x-nonce': 'client-chosen', 'content-security-policy': "script-src 'nonce-client-chosen'" },
];
// Measured on Next 16.4.1: both answer HTTP 200 with every script stamped
// (soft 404, the U-03 / PC-J526 class). Outside <Suspense> Next streams the
// bare `__next_error__` shell; only the in-Suspense page must keep its HTML.
const SOFT_NOT_FOUND = [
  { path: '/listening/ielts/80-days/999', errorShell: false },
  { path: '/home/csp-not-found-probe/x', errorShell: true },
];

const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function get(rawPath, headers = {}) {
  const base = new URL(BASE);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: base.hostname, port: base.port, path: rawPath, headers, timeout: 30_000 }, (res) => {
      let html = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { html += chunk; });
      res.on('end', () => {
        const blocking = res.headers['content-security-policy'];
        resolve({
          status: res.statusCode,
          policies: blocking === undefined ? 0 : [].concat(blocking).length,
          contentSecurityPolicy: blocking === undefined ? null : [].concat(blocking).join(', '),
          reportOnly: res.headers['content-security-policy-report-only'] ?? null,
          html,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${rawPath}`)));
    req.on('error', reject);
    req.end();
  });
}

const nonced = (res) => /'nonce-/.test(res.contentSecurityPolicy || '') || /'nonce-/.test(res.reportOnly || '');
const stampedScripts = (html) => (html.match(/<script\b[^>]*\snonce="[^"]*"[^>]*>/g) || []).length;

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

const initScript = `
window.__CSP_REPORTS__ = [];
document.addEventListener('securitypolicyviolation', function (e) {
  window.__CSP_REPORTS__.push({ disposition: e.disposition, directive: e.effectiveDirective,
    blocked: e.blockedURI, source: e.sourceFile });
}, true);
window.__AVER_SUPABASE_CLIENT__ = { auth: {
  getSession: async function () { return { data: { session: { access_token: 'fixture-token',
    user: { id: '${USER}', email: 'csp404@example.test' } } }, error: null }; },
  onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} };`;

async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript({ content: initScript });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === BASE) return route.continue();
    if (url.origin !== API) return route.abort();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'authorization,content-type,x-request-id',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    if (url.pathname === '/auth/me') {
      return json({ id: USER, email: 'csp404@example.test', role: 'user', is_active: true, display_name: 'CSP 404' });
    }
    if (url.pathname === '/auth/check-active') return json({ is_active: true });
    // This verifier only judges CSP; pages may show their own error state.
    return json({ detail: 'No fixture for this request' }, 404);
  });
  const page = await context.newPage();
  const consoleCsp = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) consoleCsp.push(message.text().slice(0, 200));
  });
  return { context, page, consoleCsp };
}

async function browserCheck(browser, label, status, { card = true } = {}) {
  const { context, page, consoleCsp } = await newPage(browser);
  const response = await page.goto(`${BASE}${label}`, { waitUntil: 'domcontentloaded' });
  check(`${label}: browser HTTP ${status}`, response?.status() === status, String(response?.status()));
  // app-bootstrap sets window.next; React tags hydrated nodes with a fiber key.
  const hydrated = await page.waitForFunction(() => window.next?.appDir === true
    && Object.keys(document.body).some((key) => key.startsWith('__reactFiber$')), null, { timeout: 15_000 })
    .then(() => true, () => false);
  check(`${label}: Next scripts ran (React hydrated)`, hydrated);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
  if (card) check(`${label}: 404 card visible`, await page.getByText(CARD).isVisible().catch(() => false));
  const reports = await page.evaluate(() => window.__CSP_REPORTS__ || []);
  check(`${label}: 0 securitypolicyviolation events`, reports.length === 0, JSON.stringify(reports.slice(0, 3)));
  check(`${label}: 0 console CSP messages`, consoleCsp.length === 0, consoleCsp.slice(0, 2).join(' | '));
  await context.close();
}

console.log(`CSP on signed-in 404s (${enforced ? 'enforced' : 'Report-Only'} build) at ${BASE}`);

console.log('1. proxy route table vs compiled routes-manifest');
const manifest = JSON.parse(readFileSync(path.join(FRONTEND, '.next/routes-manifest.json'), 'utf8'));
const compiled = [...new Set([...manifest.staticRoutes, ...manifest.dynamicRoutes]
  .map((route) => route.page).filter(nonceRouteAllowed))].sort();
const table = collectNonceRoutes(FRONTEND);
check(`table has the ${compiled.length} compiled routes under the nonce prefixes, nothing else`,
  JSON.stringify(table) === JSON.stringify(compiled),
  `only compiled: ${compiled.filter((r) => !table.includes(r)).join(' ') || '-'}; only table: ${table.filter((r) => !compiled.includes(r)).join(' ') || '-'}`);
const rewrites = Array.isArray(manifest.rewrites) ? manifest.rewrites
  : [...(manifest.rewrites?.beforeFiles ?? []), ...(manifest.rewrites?.afterFiles ?? []), ...(manifest.rewrites?.fallback ?? [])];
check('no rewrite routes a URL under the nonce prefixes', rewrites.every((rule) => !nonceRouteAllowed(rule.source)),
  rewrites.filter((rule) => nonceRouteAllowed(rule.source)).map((rule) => rule.source).join(' '));
check('the probe fixture route is in this build (tests/fixtures/csp-not-found-probe)', table.includes('/home/csp-not-found-probe/[id]'));

const reference = await get('/nope-top-level');
const baseline = reference.contentSecurityPolicy;
check('/nope-top-level baseline: one nonce-free blocking policy with self + unsafe-inline',
  reference.policies === 1 && BASELINE_SCRIPT.test(baseline || '') && !/nonce-|strict-dynamic|,/.test(baseline || ''),
  String(baseline).slice(0, 120));
const isBaseline = (res) => res.policies === 1 && res.contentSecurityPolicy === baseline && res.reportOnly === null;

console.log('2. real signed-in routes keep the nonce policy');
for (const route of REAL_ROUTES) {
  const found = auditNonceRoute(route, await get(route), await get(route), { enforced });
  check(`${route}: 2xx, one ${enforced ? 'enforced' : 'Report-Only'} nonce policy on every <script>, fresh nonce`, found.length === 0, found.join('; '));
}

console.log('3. signed-in 404s get the public baseline');
const browser = await launch();
try {
  for (const route of NOT_FOUND) {
    for (const [i, res] of [await get(route), await get(route)].entries()) {
      check(`${route} #${i + 1}: HTTP 404`, res.status === 404, String(res.status));
      check(`${route} #${i + 1}: exactly the public baseline, no nonce, no Report-Only`, isBaseline(res),
        `${res.policies} policies; ${String(res.contentSecurityPolicy).slice(0, 80)}; RO=${res.reportOnly ? 'yes' : 'no'}`);
      check(`${route} #${i + 1}: no <script> carries a nonce`, stampedScripts(res.html) === 0);
      check(`${route} #${i + 1}: 404 card in the server HTML, not the bare error shell`,
        res.html.includes(CARD) && !res.html.includes('id="__next_error__"'));
    }
    await browserCheck(browser, route, 404);
  }

  console.log('4. path confusion and forged routing headers');
  for (const route of CONFUSION) {
    const res = await get(route);
    const audit = auditNonceResponse(res, { enforced });
    if (res.status === 200) {
      check(`${route}: HTTP 200 with the nonce policy on every <script>`,
        res.policies === 1 && audit.nonce !== null && audit.scripts > 0 && audit.unnonced.length === 0,
        `${audit.unnonced.length}/${audit.scripts} unstamped`);
    } else if (res.status === 404) {
      check(`${route}: HTTP 404 with the public baseline`, isBaseline(res) && stampedScripts(res.html) === 0,
        String(res.contentSecurityPolicy).slice(0, 80));
    } else {
      check(`${route}: HTTP ${res.status} is a redirect without a document`, res.status >= 300 && res.status < 400, String(res.status));
    }
  }
  for (const route of ['/admin', '/home']) {
    for (const headers of FORGED) {
      const found = auditNonceRoute(route, await get(route, headers), await get(route, headers), { enforced });
      check(`${route} with ${Object.keys(headers).join('+')}: still the nonce policy`, found.length === 0, found.join('; '));
    }
  }

  console.log('5. notFound() in request-time pages');
  for (const { path: route, errorShell } of SOFT_NOT_FOUND) {
    for (const [i, res] of [await get(route), await get(route)].entries()) {
      const audit = auditNonceResponse(res, { enforced });
      const stamped = res.policies === 1 && audit.nonce !== null && audit.scripts > 0 && audit.unnonced.length === 0;
      check(`${route} #${i + 1}: HTTP ${res.status}; ${stamped ? `nonce policy on all ${audit.scripts} <script>` : 'public baseline, no stamped script'}`,
        stamped || (isBaseline(res) && !nonced(res) && stampedScripts(res.html) === 0),
        `${res.policies} policies; ${audit.unnonced.length}/${audit.scripts} unstamped`);
      const shell = res.html.includes('id="__next_error__"');
      check(`${route} #${i + 1}: noindex${shell ? ' (bare error shell)' : ', full server HTML'}`,
        res.html.includes('<meta name="robots" content="noindex"') && (errorShell || !shell));
    }
    await browserCheck(browser, route, (await get(route)).status);
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\nCSP 404: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nCSP 404: signed-in 404s keep the public baseline, real routes keep the nonce ✓');
