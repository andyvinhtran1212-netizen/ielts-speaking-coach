// Vercel Deployment Protection bypass for staging-e2e (plan §12/§7.1).
//
// Both Vercel automation headers must only ever reach the STAGING frontend
// origin: sending either browser-wide breaks CORS on cross-origin requests
// (Railway/fonts do not allow arbitrary custom headers).
//
// `x-vercel-protection-bypass` is sent once through APIRequestContext to mint
// the `_vercel_jwt` cookie. `x-vercel-skip-toolbar` is installed through an
// origin-scoped browser route, per Vercel's documented E2E contract. Vercel can
// still inject `<vercel-live-feedback>` on the staging custom alias even when
// the document request carries that header, so an init script also removes the
// platform-owned element before React hydrates. This keeps Gate E scoped to the
// application under test instead of accepting a third-party React #418.
// @ts-check

const BYPASS = process.env.STAGING_BYPASS || '';
const PRODUCTION_ORIGINS = Object.freeze([
  'ielts-speaking-coach-production.up.railway.app',
  'huwsmtubwulikhlmcirx.supabase.co',
]);

// Direct API probes need only the bypass secret. Adding
// `x-vercel-set-bypass-cookie` changes Vercel's response into a platform-owned
// 307 back to the same URL; that masks the application's own redirect whenever
// a test deliberately sets `maxRedirects: 0`.
function buildBypassHeaders(secret, { setCookie = false } = {}) {
  if (!secret) return {};
  return {
    'x-vercel-protection-bypass': secret,
    ...(setCookie ? { 'x-vercel-set-bypass-cookie': 'true' } : {}),
  };
}
const BYPASS_HEADERS = buildBypassHeaders(BYPASS);
const BYPASS_COOKIE_HEADERS = buildBypassHeaders(BYPASS, { setCookie: true });
const TOOLBAR_HEADER = Object.freeze({ 'x-vercel-skip-toolbar': '1' });
const TOOLBAR_TAG = 'vercel-live-feedback';
const TOOLBAR_SCRIPT_PATTERN = 'https://vercel.live/_next-live/**';
const toolbarScopedContexts = new WeakSet();

/** Ignore only the CSP report emitted for Vercel's staging-only toolbar. */
function isVercelToolbarCspNoise(message) {
  return message.includes("https://vercel.live/_next-live/feedback/feedback.js")
    && message.includes('violates the following Content Security Policy directive');
}

/** Runs before page scripts and synchronously rejects Vercel's injected node. */
function suppressInjectedVercelToolbar(tagName) {
  document.querySelectorAll(tagName).forEach((node) => node.remove());
  if (!globalThis.customElements || !globalThis.HTMLElement) return;

  const registry = globalThis.customElements;
  const nativeDefine = registry.define.bind(registry);
  if (!registry.get(tagName)) {
    nativeDefine(tagName, class extends globalThis.HTMLElement {
      connectedCallback() { this.remove(); }
    });
  }

  // The platform script may attempt to register its implementation after our
  // inert element. Ignore only that duplicate while preserving the registry
  // contract for every application-owned custom element.
  registry.define = (name, constructor, options) => {
    if (String(name).toLowerCase() === tagName) return;
    nativeDefine(name, constructor, options);
  };
}

/** Install Vercel's automation-only toolbar opt-out on the frontend origin. */
async function installToolbarSkip(context, baseURL) {
  if (toolbarScopedContexts.has(context)) return;
  const origin = new URL(baseURL).origin;
  await context.addInitScript(suppressInjectedVercelToolbar, TOOLBAR_TAG);
  // Vercel can ignore the skip header on a custom Preview alias and inject a
  // script that retries hundreds of times. Neutralize only the platform toolbar
  // namespace so application requests and the production-egress guard remain
  // observable while load/networkidle can settle deterministically.
  await context.route(TOOLBAR_SCRIPT_PATTERN, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '',
    });
  });
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
  const res = await context.request.get(baseURL + '/', { headers: BYPASS_COOKIE_HEADERS });
  if (!res.ok()) throw new Error(`bypass priming failed: HTTP ${res.status()}`);
}

module.exports = {
  BYPASS_HEADERS,
  buildBypassHeaders,
  PRODUCTION_ORIGINS,
  TOOLBAR_HEADER,
  TOOLBAR_SCRIPT_PATTERN,
  TOOLBAR_TAG,
  isVercelToolbarCspNoise,
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

// ADMINAAL2-0032 FR-016: the synthetic admin signs in ONLY through
// signInSession/signIn below (frontend/tests/staging-e2e-admin-aal2-contract
// pins that). With STAGING_E2E_ADMIN_TOTP_SECRET set, the admin's password
// session is stepped up to AAL2 with the TOTP factor enrolled by
// backend/scripts/staging_seed.py. Unset keeps the AAL1 password session,
// which is valid only while ADMIN_AAL2_ENFORCE is off. The secret, the codes
// and the tokens are never logged or put into an error message.
const ADMIN_TOTP_ENV = 'STAGING_E2E_ADMIN_TOTP_SECRET';
// A successful TOTP verify deletes every other AAL1 session of the admin
// (research.md §9.3), so a half-finished admin sign-in elsewhere can lose its
// session between the password grant and the verify. Retry only that case.
const ADMIN_STEP_UP_ATTEMPTS = 3;

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`${ADMIN_TOTP_ENV} is not valid base32.`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (!out.length) throw new Error(`${ADMIN_TOTP_ENV} is not valid base32.`);
  return Buffer.from(out);
}

/** RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits), as GoTrue verifies it. */
function totpCode(secretBase32, nowMs = Date.now(), { step = 30, digits = 6 } = {}) {
  const { createHmac } = require('node:crypto');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / step)));
  const mac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

async function gotrueError(res) {
  // GoTrue error bodies carry codes and messages only; never echo a request.
  let body = {};
  try { body = await res.json(); } catch { /* non-JSON body */ }
  const code = body.error_code || body.code || body.error || '';
  const msg = body.msg || body.message || body.error_description || '';
  return { status: res.status(), code: String(code), text: `HTTP ${res.status()} ${code} ${msg}`.trim() };
}

async function passwordSession(request, role, password) {
  const res = await request.post(
    `${STAGING_SUPABASE}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: STAGING_ANON, 'Content-Type': 'application/json' },
      data: { email: identityEmail(role), password },
    },
  );
  if (res.status() !== 200) {
    throw new Error(`sign-in failed for ${role}: ${(await gotrueError(res)).text}`);
  }
  return res.json();
}

/** Challenge + verify the admin's TOTP factor; returns the AAL2 session. */
async function stepUpAdmin(request, session, secret) {
  const factor = (session.user?.factors || []).find(
    (f) => f.factor_type === 'totp' && f.status === 'verified',
  );
  if (!factor) {
    throw new Error(
      `${ADMIN_TOTP_ENV} is set but the staging admin has no verified TOTP factor; `
        + 'run backend/scripts/staging_seed.py (ADMINAAL2-0032 T009).',
    );
  }
  const headers = {
    apikey: STAGING_ANON,
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
  const factorUrl = `${STAGING_SUPABASE}/auth/v1/factors/${encodeURIComponent(factor.id)}`;
  const challenge = await request.post(`${factorUrl}/challenge`, { headers, data: {} });
  if (challenge.status() !== 200) return { error: await gotrueError(challenge), step: 'challenge' };
  const { id: challengeId } = await challenge.json();
  const verify = await request.post(`${factorUrl}/verify`, {
    headers, data: { challenge_id: challengeId, code: totpCode(secret) },
  });
  if (verify.status() !== 200) return { error: await gotrueError(verify), step: 'verify' };
  return { session: await verify.json() };
}

/**
 * Password sign-in on staging Supabase; returns the complete GoTrue session
 * (`access_token`, `refresh_token`, `expires_at`, `user`). For `admin` with
 * STAGING_E2E_ADMIN_TOTP_SECRET set, the returned session is AAL2.
 */
async function signInSession(request, role) {
  const password = process.env.E2E_PASSWORD || '';
  if (!password) {
    throw new Error('E2E_PASSWORD is required (must match staging_seed.py).');
  }
  const secret = role === 'admin' ? (process.env[ADMIN_TOTP_ENV] || '') : '';
  let session;
  if (!secret) {
    session = await passwordSession(request, role, password);
  } else {
    let last;
    for (let attempt = 1; attempt <= ADMIN_STEP_UP_ATTEMPTS && !session; attempt += 1) {
      const result = await stepUpAdmin(request, await passwordSession(request, role, password), secret);
      session = result.session;
      last = result;
      if (!session && result.error.code !== 'session_not_found') break;
    }
    if (!session) {
      throw new Error(`admin AAL2 ${last.step} failed: ${last.error.text}`);
    }
  }
  session.expires_at ||= Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
  return session;
}

/** Bearer access token for `role`; AAL2 for the admin when the secret is set. */
async function signIn(request, role) {
  return (await signInSession(request, role)).access_token;
}

// ADMINAAL2-0032 Amendment 1 (FR-020): these admin routes need a TOTP entered
// within ADMIN_STEP_UP_MINUTES (15). A spec must not reuse an admin token from
// an earlier step for them (tests/staging-e2e-admin-aal2-contract.test.mjs).
const STEP_UP_ROUTE_PATTERN = /\/admin\/users\/[^'"`\s]*\/(?:role|active|revoke-sessions)\b/;

/**
 * A NEW admin sign-in for one sensitive step: password grant + TOTP verify,
 * so the token's amr TOTP time is "now". Call it right before each request
 * that matches STEP_UP_ROUTE_PATTERN. Without STAGING_E2E_ADMIN_TOTP_SECRET
 * this is an AAL1 token, which passes only while ADMIN_STEP_UP_ENFORCE is off.
 */
async function freshAdminToken(request) {
  return (await signInSession(request, 'admin')).access_token;
}

/**
 * Remove one synthetic Speaking session through the staging-only admin seam.
 * Cleanup is intentionally fail-loud: a green soak run must not consume a
 * hidden daily-quota slot that makes a later run fail for accumulated state.
 */
async function cleanupE2ESession(request, sessionId, adminToken) {
  if (!sessionId) return;
  const response = await request.delete(
    `${STAGING_API}/admin/e2e/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  if (response.status() !== 204) {
    throw new Error(
      `E2E session cleanup failed for ${sessionId}: `
        + `HTTP ${response.status()} ${await response.text()}`,
    );
  }
}

module.exports.STAGING_API = STAGING_API;
module.exports.STAGING_SUPABASE = STAGING_SUPABASE;
module.exports.STAGING_ANON = STAGING_ANON;
module.exports.signIn = signIn;
module.exports.signInSession = signInSession;
module.exports.freshAdminToken = freshAdminToken;
module.exports.STEP_UP_ROUTE_PATTERN = STEP_UP_ROUTE_PATTERN;
module.exports.totpCode = totpCode;
module.exports.ADMIN_TOTP_ENV = ADMIN_TOTP_ENV;
module.exports.identityEmail = identityEmail;
module.exports.cleanupE2ESession = cleanupE2ESession;
