// Vercel Deployment Protection bypass for staging-e2e (plan §12/§7.1).
//
// The bypass header must only ever reach the STAGING origin: sending it
// browser-wide breaks CORS on every cross-origin request (custom headers
// force preflights that Railway/fonts don't allow). So we make ONE
// request-level call with the header + x-vercel-set-bypass-cookie, which
// drops a `_vercel_jwt` cookie into the context — after that the browser
// navigates the protected deployment with no special headers at all.
// @ts-check

const BYPASS = process.env.STAGING_BYPASS || '';

const BYPASS_HEADERS = BYPASS
  ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' }
  : {};

/** Prime the protection-bypass cookie into a browser context. */
async function primeBypassCookie(context, baseURL) {
  if (!BYPASS) return;
  const res = await context.request.get(baseURL + '/', { headers: BYPASS_HEADERS });
  if (!res.ok()) throw new Error(`bypass priming failed: HTTP ${res.status()}`);
}

module.exports = { BYPASS_HEADERS, primeBypassCookie };

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
