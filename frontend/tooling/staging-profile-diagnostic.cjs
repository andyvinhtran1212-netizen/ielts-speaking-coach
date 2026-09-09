// Read-only staging profile journey diagnosis. Never logs headers, bodies,
// credentials, personal fields, cookies, storage contents or browser traces.
const { chromium, request, expect } = require('@playwright/test');
const {
  primeBypassCookie, identityEmail, STAGING_API, STAGING_SUPABASE, STAGING_ANON,
} = require('../tests/staging-e2e/helpers.js');

const BASE = 'https://staging.averlearning.com';
const STORAGE_KEY = `sb-${new URL(STAGING_SUPABASE).hostname.split('.')[0]}-auth-token`;
const PRODUCTION = new Set(['www.averlearning.com', 'averlearning.com',
  'ielts-speaking-coach-production.up.railway.app', 'huwsmtubwulikhlmcirx.supabase.co']);

function category(raw) {
  const u = new URL(raw);
  if (u.origin === STAGING_API && ['/auth/profile', '/auth/me', '/api/analytics/events', '/api/error-logs'].includes(u.pathname)) return u.pathname;
  if (u.origin === STAGING_SUPABASE && u.pathname.startsWith('/auth/')) return 'staging-auth';
  if (u.origin === BASE && u.pathname.startsWith('/_next/')) return 'next-resource';
  if (u.origin === BASE && ['/profile', '/js/api.js', '/js/runtime-config.js'].includes(u.pathname)) return u.pathname;
  return 'other-resource';
}

async function main() {
  if (!process.env.E2E_PASSWORD || !process.env.STAGING_BYPASS) throw new Error('configured staging secrets required');
  const api = await request.newContext({ timeout: 20000 });
  const browser = await chromium.launch();
  let failures = 0;
  try {
    for (let trial = 0; trial < 8; trial++) {
      const login = await api.post(`${STAGING_SUPABASE}/auth/v1/token?grant_type=password`, {
        headers: { apikey: STAGING_ANON, 'Content-Type': 'application/json' },
        data: { email: identityEmail('student'), password: process.env.E2E_PASSWORD },
      });
      if (!login.ok()) throw new Error(`synthetic login HTTP ${login.status()}`);
      const session = await login.json();
      session.expires_at ||= Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
      const context = await browser.newContext({ baseURL: BASE });
      context.setDefaultTimeout(20000);
      await primeBypassCookie(context, BASE);
      let unexpectedWrites = 0;
      let blockedBackgroundWrites = 0;
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (PRODUCTION.has(url.hostname)) return route.abort('blockedbyclient');
        if (url.origin === STAGING_API && !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
          if (url.pathname === '/auth/profile') unexpectedWrites++;
          else blockedBackgroundWrites++;
          return route.abort('blockedbyclient');
        }
        return route.fallback();
      });
      await context.addInitScript(([key, value]) => {
        if (!window.localStorage.getItem('__e2e_seeded')) {
          window.localStorage.setItem(key, value);
          window.localStorage.setItem('__e2e_seeded', '1');
        }
      }, [STORAGE_KEY, JSON.stringify(session)]);
      const page = await context.newPage();
      const started = Date.now();
      const pending = new Map();
      const events = [];
      const emit = event => { if (events.length < 150) events.push({ ms: Date.now() - started, ...event }); };
      page.on('request', req => {
        pending.set(req, { kind: category(req.url()), started: Date.now() });
        emit({ event: 'request', kind: category(req.url()), method: req.method() });
      });
      page.on('response', res => emit({ event: 'response', kind: category(res.url()), status: res.status() }));
      page.on('requestfinished', req => {
        const entry = pending.get(req);
        emit({ event: 'finished', kind: category(req.url()), duration: entry ? Date.now() - entry.started : null });
        pending.delete(req);
      });
      page.on('requestfailed', req => {
        emit({ event: 'failed', kind: category(req.url()), code: req.failure()?.errorText?.match(/net::ERR_[A-Z_]+/)?.[0] || 'network-failure' });
        pending.delete(req);
      });
      page.on('pageerror', error => emit({ event: 'pageerror', name: error.name,
        reactCode: error.message.match(/Minified React error #\d+/)?.[0] || null }));
      page.on('console', msg => {
        if (msg.type() === 'error') emit({ event: 'console-error', reactCode: msg.text().match(/Minified React error #\d+/)?.[0] || null });
      });
      // Reproduce the routing stack from the failed double-submit case. No
      // click or mutation is made; a write indicates an unexpected side effect.
      if (trial % 2) await page.route('**/auth/profile', async route => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        unexpectedWrites++;
        return route.abort('blockedbyclient');
      });
      let passed = false;
      try {
        await page.goto('/profile', { timeout: 30000 });
        await expect(page.locator('#profile-email')).toHaveText(identityEmail('student'), { timeout: 20000 });
        passed = true;
      } catch { /* verdict below, never print arbitrary Playwright error text */ }
      const snapshot = await page.evaluate(() => ({
        path: location.pathname,
        release: document.documentElement.getAttribute('data-release'),
        apiReady: typeof window.api?.getWith === 'function',
        authClientReady: typeof window.getSupabase === 'function',
        profilePlaceholder: document.getElementById('profile-email')?.textContent === '—',
        saveDisabled: document.getElementById('btn-save')?.disabled ?? null,
        toastVisible: document.getElementById('toast')?.classList.contains('show') ?? null,
      })).catch(() => ({ snapshotUnavailable: true }));
      if (!passed || unexpectedWrites) failures++;
      console.log(JSON.stringify({ trial: trial + 1, routeInterception: Boolean(trial % 2),
        passed, unexpectedWrites, blockedBackgroundWrites, snapshot, events,
        pending: [...pending.values()].map(({ kind, started }) => ({ kind, duration: Date.now() - started })) }));
      await context.close();
    }
  } finally {
    await browser.close();
    await api.dispose();
  }
  console.log(JSON.stringify({ trials: 8, failures, gateEvidence: false }));
  process.exitCode = failures ? 1 : 0;
}
module.exports = { category, PRODUCTION };
if (require.main === module) {
  main().catch(() => { console.error('Diagnostic could not complete; no sensitive error body emitted.'); process.exitCode = 1; });
}
