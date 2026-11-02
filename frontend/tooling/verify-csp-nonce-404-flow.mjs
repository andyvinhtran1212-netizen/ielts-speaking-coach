// PC-J566 / SEC-CSP-NONCE: 404s under the signed-in prefixes. proxy.ts gives
// every `/home/…`, `/admin/…`, `/instructor/…`, `/vocabulary/…/…` URL the nonce policy by
// prefix, including URLs no route matches. Next serves those from the root
// not-found page; prerendered, it carried no nonce, so the enforced policy on
// staging blocked all 19 scripts (reports/cspenf-staging-20261103-0226.md).
//
// Against a real `next build` + `next start`, for each URL: the HTTP status,
// exactly one policy carrying a fresh per-request nonce, every served <script>
// carrying it, the 404 card in the server HTML, then Chromium: 0
// `securitypolicyviolation` events, 0 console CSP errors, and React hydrated
// (so 0 reports means the scripts actually ran). The public 404 controls
// (`/nope-top-level`, `/login/nope-xyz`) keep the original nonce-free policy. CSP is not bypassed.
//
//   node tooling/verify-csp-nonce-404-flow.mjs http://localhost:3000             # Report-Only build (CI default)
//   node tooling/verify-csp-nonce-404-flow.mjs --enforced http://localhost:3000  # AVER_CSP_NONCE_ENFORCE=1 build
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

import { auditNonceResponse, auditNonceRoute } from './check-csp-nonce-deployed.mjs';

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

const ROUTES = [
  // a. a signed-in prefix with no index page; b. nested; c. admin, instructor.
  { path: '/practice', status: 404 },
  { path: '/home/does-not-exist', status: 404 },
  { path: '/vocabulary/nope/xyz/abc', status: 404 },
  { path: '/admin/nope-xyz', status: 404 },
  { path: '/instructor/nope-xyz', status: 404 },
  // d. notFound() in a request-time page under <Suspense>: a soft 404
  // (HTTP 200 + noindex) under cacheComponents, unchanged by PC-J566; the
  // card streams in the RSC payload. It must still carry the nonce.
  { path: '/listening/ielts/80-days/999', status: 200, softNotFound: true },
  // Public controls: the root 404 without the proxy's nonce policy. /login is
  // outside the proxy matcher (SA-1029-CSP1 F1), so its 404 must stay here.
  { path: '/nope-top-level', status: 404, public: true },
  { path: '/login/nope-xyz', status: 404, public: true },
];

const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) return chromium.launch({ executablePath: chrome });
    throw error;
  }
}

async function get(path) {
  const res = await fetch(new URL(path, BASE), { redirect: 'manual' });
  return {
    status: res.status,
    reportOnly: res.headers.get('content-security-policy-report-only'),
    contentSecurityPolicy: res.headers.get('content-security-policy'),
    html: await res.text(),
  };
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

console.log(`CSP nonce on signed-in 404s (${enforced ? 'enforced' : 'Report-Only'} build) at ${BASE}`);
const browser = await launch();
try {
  for (const route of ROUTES) {
    const label = route.path;
    const first = await get(route.path);
    const second = await get(route.path);

    if (route.public) {
      for (const [i, res] of [first, second].entries()) {
        check(`${label} #${i + 1}: HTTP 404`, res.status === 404, String(res.status));
        check(`${label} #${i + 1}: original nonce-free blocking policy, no Report-Only`,
          BASELINE_SCRIPT.test(res.contentSecurityPolicy || '') && !/nonce-|strict-dynamic|,/.test(res.contentSecurityPolicy || '')
            && res.reportOnly === null, String(res.contentSecurityPolicy).slice(0, 120));
        check(`${label} #${i + 1}: no <script> carries a nonce`, !/<script\b[^>]*\snonce="/.test(res.html));
        check(`${label} #${i + 1}: 404 card in the server HTML`, res.html.includes(CARD));
      }
    } else {
      const found = auditNonceRoute(label, first, second, { enforced, status: route.status });
      const audit = auditNonceResponse(second, { enforced });
      check(`${label}: HTTP ${route.status}, one ${enforced ? 'enforced' : 'Report-Only'} nonce policy, all ${audit.scripts} <script> tags carry it, fresh nonce per request`,
        found.length === 0, found.join('; '));
      if (!enforced) {
        check(`${label}: enforced policy unchanged (no nonce)`,
          [first, second].every((res) => BASELINE_SCRIPT.test(res.contentSecurityPolicy || '')
            && !/nonce-|strict-dynamic/.test(res.contentSecurityPolicy || '')));
      }
      for (const [i, res] of [first, second].entries()) {
        check(`${label} #${i + 1}: rendered with noindex, not the bare error shell`,
          res.html.includes('<meta name="robots" content="noindex"') && !res.html.includes('id="__next_error__"'));
        if (!route.softNotFound) check(`${label} #${i + 1}: 404 card in the server HTML`, res.html.includes(CARD));
      }
    }

    const { context, page, consoleCsp } = await newPage(browser);
    const response = await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' });
    check(`${label}: browser HTTP ${route.status}`, response?.status() === route.status, String(response?.status()));
    // app-bootstrap sets window.next; React tags hydrated nodes with a fiber key.
    const hydrated = await page.waitForFunction(() => window.next?.appDir === true
      && Object.keys(document.body).some((key) => key.startsWith('__reactFiber$')), null, { timeout: 15_000 })
      .then(() => true, () => false);
    check(`${label}: Next scripts ran (React hydrated)`, hydrated);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500);
    check(`${label}: 404 card visible`, await page.getByText(CARD).isVisible().catch(() => false));
    const reports = await page.evaluate(() => window.__CSP_REPORTS__ || []);
    check(`${label}: 0 securitypolicyviolation events`, reports.length === 0, JSON.stringify(reports.slice(0, 3)));
    check(`${label}: 0 console CSP messages`, consoleCsp.length === 0, consoleCsp.slice(0, 2).join(' | '));
    await context.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\nCSP nonce 404: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nCSP nonce 404: signed-in 404s carry the request nonce, the public 404 keeps the baseline ✓');
