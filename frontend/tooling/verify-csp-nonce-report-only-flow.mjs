// PC-J38 / SEC-CSP-NONCE step 1 browser evidence. The signed-in route groups
// carry a per-request Content-Security-Policy-Report-Only
// (`script-src 'self' 'nonce-…' 'strict-dynamic' 'unsafe-inline'`) next to the
// unchanged enforced CSP; public routes carry none. On every route the page
// must load with zero Report-Only violations, every <script> in the served
// HTML must carry that request's nonce, and an injected `<img onerror>` must
// be reported (it still runs: Report-Only never blocks).
//
// CSP is NOT bypassed here, unlike most verifiers. Auth and every browser API
// read are fixture-backed; nothing is written.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3000';
const api = new URL(process.env.AVER_API_BASE || 'http://127.0.0.1:3999');
if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(api.hostname)) {
  throw new Error('AVER_API_BASE must be an explicit local fixture origin');
}
const API = api.origin;
const USER = '00000000-0000-4000-8000-000000000538';
const ID = '00000000-0000-4000-8000-0000000005aa';
const REPORT_ONLY = /^script-src 'self' 'nonce-([A-Za-z0-9+/]{16,}={0,2})' 'strict-dynamic' 'unsafe-inline'( 'unsafe-eval')?$/;

// The handoff smoke (login, speaking, writing result, admin grade, grammar
// wiki) plus the other signed-in surfaces with their own layouts.
const ROUTES = [
  { path: '/login', signedIn: false, reportOnly: false },
  { path: '/grammar', signedIn: false, reportOnly: false },
  { path: '/grammar/tenses/present-simple', signedIn: false, reportOnly: false },
  { path: '/home', reportOnly: true },
  { path: '/speaking', reportOnly: true },
  { path: `/practice/session?session_id=${ID}`, reportOnly: true },
  { path: '/writing/dashboard', reportOnly: true },
  { path: `/writing/result?essay_id=${ID}`, reportOnly: true },
  { path: '/admin', reportOnly: true },
  { path: `/admin/writing/grade?id=${ID}`, reportOnly: true },
  { path: '/admin/users', reportOnly: true },
  { path: '/instructor', reportOnly: true },
  { path: '/profile', reportOnly: true },
  { path: '/vocabulary/hub', reportOnly: true },
  { path: '/listening', reportOnly: true },
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

const initScript = (signedIn) => `
window.__CSP_REPORTS__ = [];
document.addEventListener('securitypolicyviolation', function (e) {
  window.__CSP_REPORTS__.push({ disposition: e.disposition, directive: e.effectiveDirective,
    blocked: e.blockedURI, sample: e.sample, source: e.sourceFile, line: e.lineNumber });
}, true);
window.__AVER_SUPABASE_CLIENT__ = { auth: {
  getSession: async function () { return { data: { session: ${signedIn
    ? `{ access_token: 'fixture-token', user: { id: '${USER}', email: 'csp@example.test' } }`
    : 'null'} }, error: null }; },
  onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
  signOut: async function () { return { error: null }; }
} };`;

async function newPage(browser, signedIn, apiCalls = []) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript({ content: initScript(signedIn) });
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
    apiCalls.push(`${request.method()} ${url.pathname}`);
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    if (url.pathname === '/auth/me') {
      return json({ id: USER, email: 'csp@example.test', role: 'admin', is_active: true, display_name: 'CSP Fixture' });
    }
    if (url.pathname === '/auth/check-active') return json({ is_active: true });
    // Minimal Speaking session so /practice/session reaches PracticeApp.init.
    if (url.pathname === `/sessions/${ID}/renderer-affinity`) return json({ renderer_affinity: 'next' });
    if (url.pathname === `/sessions/${ID}`) {
      return json({ id: ID, user_id: USER, part: 1, mode: 'practice', status: 'active' });
    }
    if (url.pathname === `/sessions/${ID}/questions`) {
      return json([{ id: 'q-csp-1', session_id: ID, part: 1, order_num: 1, question_text: 'Do you enjoy reading?' }]);
    }
    // Pages may show their own error state; this verifier only judges CSP.
    return json({ detail: 'No fixture for this request' }, 404);
  });
  return { context, page: await context.newPage() };
}

const reports = (page) => page.evaluate(() => window.__CSP_REPORTS__ || []);

const browser = await launch();
try {
  for (const route of ROUTES) {
    const { context, page } = await newPage(browser, route.signedIn !== false);
    const response = await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' });
    const head = response.headers();
    const enforced = head['content-security-policy'] || '';
    const reportOnly = head['content-security-policy-report-only'];
    const html = await response.text();
    const label = route.path;

    check(`${label}: enforced script-src unchanged`,
      /(^|; )script-src 'self' 'unsafe-inline'(;| )/.test(enforced) && !/nonce-|strict-dynamic/.test(enforced), enforced.slice(0, 120));

    if (route.reportOnly) {
      const nonce = REPORT_ONLY.exec(reportOnly || '')?.[1];
      check(`${label}: Report-Only nonce policy`, Boolean(nonce), String(reportOnly));
      const scripts = html.match(/<script\b[^>]*>/g) || [];
      const unnonced = scripts.filter((tag) => !tag.includes(`nonce="${nonce}"`));
      check(`${label}: all ${scripts.length} served <script> tags carry the request nonce`,
        Boolean(nonce) && scripts.length > 0 && unnonced.length === 0, unnonced.slice(0, 3).join(' '));
    } else {
      check(`${label}: no Report-Only header on a public route`, reportOnly === undefined, String(reportOnly));
    }

    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    const seen = await reports(page);
    const reportOnlySeen = seen.filter((r) => r.disposition === 'report');
    check(`${label}: 0 Report-Only violations after load`, reportOnlySeen.length === 0,
      JSON.stringify(reportOnlySeen.slice(0, 3)));
    if (route.signedIn !== false) {
      // The shared runtime chain (runtime-config → supabase → api.js) is
      // script-inserted; it must have run for "0 reports" to mean anything.
      check(`${label}: script-inserted runtime loaded (window.api)`,
        await page.evaluate(() => typeof window.api === 'object' && window.api !== null));
    }
    const enforcedSeen = seen.filter((r) => r.disposition === 'enforce');
    if (enforcedSeen.length) console.log(`    (enforced-policy reports, pre-existing: ${JSON.stringify(enforcedSeen.slice(0, 3))})`);
    await context.close();
  }

  // The fixture the handoff asks for: an injected inline handler is reported
  // by the nonce policy, and still runs because Report-Only never blocks.
  {
    const { context, page } = await newPage(browser, true);
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.evaluate(() => {
      window.__ONERROR_RAN__ = false;
      const host = document.createElement('div');
      host.innerHTML = '<img alt="" src="data:," onerror="window.__ONERROR_RAN__ = true">';
      document.body.appendChild(host);
    });
    await page.waitForFunction(() => window.__ONERROR_RAN__ === true, null, { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(300);
    const injected = (await reports(page)).filter((r) => r.disposition === 'report');
    check('injected <img onerror> is reported by the Report-Only policy',
      injected.some((r) => r.directive === 'script-src-attr' || r.directive === 'script-src'), JSON.stringify(injected));
    check('injected handler still runs (Report-Only does not block)',
      await page.evaluate(() => window.__ONERROR_RAN__ === true));
    await context.close();
  }

  // practice.js recommendation cards lost their inline onclick/onmouseover:
  // the managed document listeners must still PATCH the click and restyle on
  // hover. The card markup is the one _grammarCardHtml builds.
  {
    const apiCalls = [];
    const { context, page } = await newPage(browser, true, apiCalls);
    await page.goto(`${BASE}/practice/session?session_id=${ID}`, { waitUntil: 'domcontentloaded' });
    // init() binds the managed document listeners before it leaves loading.
    await page.waitForFunction(
      () => window.PracticePlayer?.getSnapshot?.().effectKeys.includes('grammar-rec-click'), null, { timeout: 15_000 },
    ).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const styles = await page.evaluate(() => {
      const card = document.createElement('a');
      card.dataset.recId = 'rec-csp-1';
      card.dataset.grCard = 'primary';
      card.style.background = 'rgba(20,184,166,0.07)';
      card.innerHTML = '<p>child</p>';
      document.body.appendChild(card);
      const child = card.firstChild;
      child.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      const over = card.style.background;
      child.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      const out = card.style.background;
      child.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { over, out };
    });
    await page.waitForTimeout(500);
    check('practice grammar card hover restyles through the delegated listener',
      styles.over === 'rgba(20, 184, 166, 0.12)' && styles.out === 'rgba(20, 184, 166, 0.07)', JSON.stringify(styles));
    check('practice grammar card click PATCHes the recommendation telemetry',
      apiCalls.includes('PATCH /api/grammar/recommendations/rec-csp-1/clicked'), apiCalls.filter((c) => !c.startsWith('GET')).join(', '));
    await context.close();
  }

  // A fresh nonce per request, and a client cannot choose it.
  {
    const forged = 'Zm9yZ2VkZm9yZ2VkZm9yZ2Vk';
    const nonceOf = async (headers = {}) => {
      const res = await fetch(`${BASE}/admin`, { headers });
      const body = await res.text();
      return { nonce: REPORT_ONLY.exec(res.headers.get('content-security-policy-report-only') || '')?.[1], body };
    };
    const first = await nonceOf();
    const second = await nonceOf();
    check('every request gets a new nonce', Boolean(first.nonce && second.nonce) && first.nonce !== second.nonce);
    const spoofed = await nonceOf({ 'x-nonce': forged, 'content-security-policy': `script-src 'nonce-${forged}'` });
    check('client-sent x-nonce / CSP request headers are ignored',
      Boolean(spoofed.nonce) && spoofed.nonce !== forged && !spoofed.body.includes(forged));
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\nCSP nonce Report-Only: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nCSP nonce Report-Only: signed-in routes nonce-clean, public routes untouched, injected handler reported ✓');
