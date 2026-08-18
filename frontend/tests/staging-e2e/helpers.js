// Vercel Deployment Protection bypass for staging-e2e (plan §12/§7.1).
//
// Both Vercel automation headers must only ever reach the STAGING frontend
// origin: sending either browser-wide breaks CORS on cross-origin requests
// (Railway/fonts do not allow arbitrary custom headers).
//
// `x-vercel-protection-bypass` is sent once through APIRequestContext to mint
// the `_vercel_jwt` cookie. `x-vercel-skip-toolbar` is installed through an
// origin-scoped browser route, per Vercel's documented E2E contract. Without
// it, Preview Feedback can inject `<vercel-live-feedback>` into `<body>` before
// React hydrates and create a nondeterministic React #418 that is not emitted
// by the application under test.
// @ts-check

const BYPASS = process.env.STAGING_BYPASS || '';
const PRODUCTION_ORIGINS = Object.freeze([
  'ielts-speaking-coach-production.up.railway.app',
  'huwsmtubwulikhlmcirx.supabase.co',
]);

const BYPASS_HEADERS = BYPASS
  ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' }
  : {};
const TOOLBAR_HEADER = Object.freeze({ 'x-vercel-skip-toolbar': '1' });
const toolbarScopedContexts = new WeakSet();

/** Install Vercel's automation-only toolbar opt-out on the frontend origin. */
async function installToolbarSkip(context, baseURL) {
  if (toolbarScopedContexts.has(context)) return;
  const origin = new URL(baseURL).origin;
  await context.route(`${origin}/**`, async (route) => {
    await route.continue({
      headers: { ...route.request().headers(), ...TOOLBAR_HEADER },
    });
  });
  toolbarScopedContexts.add(context);
}

/** Prime the protection-bypass cookie into a browser context. */
async function primeBypassCookie(context, baseURL) {
  await installToolbarSkip(context, baseURL);
  if (!BYPASS) return;
  const res = await context.request.get(baseURL + '/', { headers: BYPASS_HEADERS });
  if (!res.ok()) throw new Error(`bypass priming failed: HTTP ${res.status()}`);
}

module.exports = {
  BYPASS_HEADERS,
  PRODUCTION_ORIGINS,
  TOOLBAR_HEADER,
  installToolbarSkip,
  primeBypassCookie,
};

// ── Shared staging API helpers (Gate A flows) ────────────────────────────

const STAGING_SUPABASE = 'https://zjphffoujxkpltixsbzj.supabase.co';
const STAGING_API = 'https://ielts-speaking-coach-staging.up.railway.app';
// Public (publishable) staging anon key — same value the staging
// runtime-config ships to every browser.
const STAGING_ANON = process.env.STAGING_SUPABASE_ANON ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqcGhmZm91anhrcGx0aXhzYnpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMTA5ODUsImV4cCI6MjA5MjU4Njk4NX0.A8CSIWH-_p8baHBSGDaNJ2kWyQVgZOLlSX3dD1lOuGU';

const E2E_NS = process.env.E2E_NS || 'smoke';
const identityEmail = (role) => `e2e-${role}-${E2E_NS}@staging-e2e.averlearning.com`;

/** Password sign-in on staging Supabase; returns a bearer access token. */
async function signIn(request, role) {
  const password = process.env.E2E_PASSWORD || '';
  if (!password) {
    throw new Error('E2E_PASSWORD is required (must match staging_seed.py).');
  }
  const res = await request.post(
    `${STAGING_SUPABASE}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: STAGING_ANON, 'Content-Type': 'application/json' },
      data: { email: identityEmail(role), password },
    },
  );
  if (res.status() !== 200) {
    throw new Error(`sign-in failed for ${role}: HTTP ${res.status()} ${await res.text()}`);
  }
  return (await res.json()).access_token;
}

module.exports.STAGING_API = STAGING_API;
module.exports.STAGING_SUPABASE = STAGING_SUPABASE;
module.exports.STAGING_ANON = STAGING_ANON;
module.exports.signIn = signIn;
module.exports.identityEmail = identityEmail;
