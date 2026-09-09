// Diagnostic only: synthetic identity, no app writes, no audio, no auth traces.
const { chromium, request, expect } = require('@playwright/test');
const { primeBypassCookie, identityEmail, STAGING_API, STAGING_SUPABASE, STAGING_ANON } = require('../tests/staging-e2e/helpers');
const { PRODUCTION } = require('./staging-profile-diagnostic.cjs');
const BASE = 'https://staging.averlearning.com';
const SHA = '17159ba0eaa8a2e889f981ba49abfe43101d0601';
const STORAGE_KEY = `sb-${new URL(STAGING_SUPABASE).hostname.split('.')[0]}-auth-token`;

function safePath(raw) {
  const url = new URL(raw);
  if (url.origin !== STAGING_API) return 'other';
  return ['/auth/me', '/auth/profile', '/topics', '/sessions', '/dashboard/summary'].includes(url.pathname)
    ? url.pathname : 'other-staging-api';
}

async function main() {
  if (!process.env.E2E_PASSWORD || !process.env.STAGING_BYPASS) throw new Error('Configured staging secrets required');
  const api = await request.newContext({ timeout: 20000 });
  const browser = await chromium.launch();
  let failures = 0;
  try {
    for (let trial = 0; trial < 8; trial++) {
      const login = await api.post(`${STAGING_SUPABASE}/auth/v1/token?grant_type=password`, {
        headers: { apikey: STAGING_ANON, 'Content-Type': 'application/json' },
        data: { email: identityEmail('student'), password: process.env.E2E_PASSWORD },
      });
      if (!login.ok()) throw new Error(`Synthetic login HTTP ${login.status()}`);
      const session = await login.json();
      session.expires_at ||= Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
      const context = await browser.newContext({ baseURL: BASE });
      await primeBypassCookie(context, BASE);
      let blockedWrites = 0;
      let attemptedSessionCreates = 0;
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (PRODUCTION.has(url.hostname)) return route.abort('blockedbyclient');
        if (url.origin === STAGING_API && !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
          blockedWrites++;
          if (url.pathname === '/sessions') attemptedSessionCreates++;
          return route.abort('blockedbyclient');
        }
        return route.fallback();
      });
      const page = await context.newPage();
      const started = Date.now();
      const events = [];
      const emit = event => { if (events.length < 100) events.push({ ms: Date.now() - started, ...event }); };
      await page.exposeFunction('__averSpeakingDiagnostic', emit);
      const delay = trial >= 4 ? 750 : 0;
      await context.addInitScript(({ key, value, origin, delayMs }) => {
        localStorage.setItem(key, value);
        const report = data => { window.__averSpeakingDiagnostic(data).catch(() => {}); };
        const originalFetch = window.fetch;
        window.fetch = function(input, options) {
          const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const url = new URL(raw, location.href);
          if (url.origin === origin) {
            const headers = new Headers(options?.headers || (input instanceof Request ? input.headers : undefined));
            report({ event: 'api-start', path: ['/auth/me', '/auth/profile', '/topics', '/sessions', '/dashboard/summary'].includes(url.pathname) ? url.pathname : 'other-staging-api',
              authorizationPresent: headers.has('authorization'), clientReady: Boolean(window.getSupabase?.()) });
          }
          return originalFetch.apply(this, arguments);
        };
        if (delayMs) {
          let initialize;
          let timer = null;
          const delayed = function(...args) {
            if (window.getSupabase?.()) return initialize.apply(this, args);
            if (!timer) {
              report({ event: 'client-init-delayed', delayMs });
              timer = setTimeout(() => {
                initialize.apply(this, args);
                report({ event: 'client-init-finished', clientReady: Boolean(window.getSupabase?.()) });
              }, delayMs);
            }
            return null;
          };
          Object.defineProperty(window, 'initSupabase', { configurable: true,
            get: () => initialize ? delayed : undefined,
            set: fn => { initialize = fn; },
          });
        }
      }, { key: STORAGE_KEY, value: JSON.stringify(session), origin: STAGING_API, delayMs: delay });
      page.on('response', res => {
        if (new URL(res.url()).origin === STAGING_API) emit({ event: 'api-response', path: safePath(res.url()), status: res.status() });
      });
      page.on('pageerror', error => emit({ event: 'pageerror', name: error.name,
        reactCode: error.message.match(/Minified React error #\d+/)?.[0] || null }));
      let validationVisible = false;
      let release = null;
      try {
        await page.goto('/speaking', { timeout: 30000 });
        release = await page.locator('html').getAttribute('data-release');
        await page.locator('.mode-card[data-mode="practice"]').first().click({ timeout: 15000 });
        await page.locator('#prac-topic-start').click({ timeout: 15000 });
        await expect(page.locator('#prac-topic-error')).toHaveText('Vui lòng chọn hoặc nhập chủ đề.', { timeout: 10000 });
        validationVisible = true;
        await page.waitForTimeout(1500);
      } catch { /* arbitrary browser/auth error text is intentionally not logged */ }
      const stillSpeaking = new URL(page.url()).pathname === '/speaking';
      // Public/background telemetry may legitimately omit auth; only the
      // known protected reads are evidence of the bootstrap race.
      const missingAuth = events.filter(e => e.event === 'api-start' && !e.authorizationPresent
        && ['/auth/me', '/auth/profile', '/sessions', '/dashboard/summary'].includes(e.path));
      const passed = validationVisible && stillSpeaking && release === SHA && attemptedSessionCreates === 0 && missingAuth.length === 0;
      if (!passed) failures++;
      console.log(JSON.stringify({ trial: trial + 1, delayMs: delay, passed, validationVisible, stillSpeaking,
        releaseMatches: release === SHA, attemptedSessionCreates, blockedWrites, missingAuthRequests: missingAuth.length, events }));
      await context.close();
    }
  } finally {
    await browser.close();
    await api.dispose();
  }
  console.log(JSON.stringify({ trials: 8, failures, gateEvidence: false }));
  process.exitCode = failures ? 1 : 0;
}

module.exports = { safePath };
if (require.main === module) main().catch(() => {
  console.error('Speaking diagnostic could not complete; sensitive error text suppressed.');
  process.exitCode = 1;
});
