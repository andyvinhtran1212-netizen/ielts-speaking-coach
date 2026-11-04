// Content-Security-Policy for every Next response (F08 / BL-07). Rationale,
// directive inventory and the `'unsafe-inline'` decision:
// docs/CONTENT_SECURITY_POLICY.md.
//
// connect-src is derived from the SAME resolution as runtime-config.js, so the
// browser may reach exactly the API and Supabase project it was built to call.
// No AI provider is listed: Whisper, Claude, Gemini, Azure Speech and the TTS
// engines are called by FastAPI only; the browser never talks to them.
import { PROD, resolveRuntimeOrigins } from './runtime-origins.mjs';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
// api.js falls back to this when runtime-config is unconfigured on localhost.
const LEGACY_LOCAL_API_ORIGIN = 'http://localhost:8000';

// Vercel's documented toolbar/comments allowance
// (https://vercel.com/docs/vercel-toolbar/managing-toolbar#using-a-content-security-policy).
// Added only to non-production Vercel builds (staging + PR previews).
export const VERCEL_TOOLBAR_SOURCES = Object.freeze({
  script: ['https://vercel.live'],
  connect: ['https://vercel.live', 'wss://ws-us3.pusher.com'],
  style: ['https://vercel.live'],
  font: ['https://vercel.live', 'https://assets.vercel.com'],
  frame: ['https://vercel.live'],
});

function browserOrigin(value, { allowLocalHttp }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`content-security-policy: invalid browser origin ${JSON.stringify(value)}`);
  }
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && allowLocalHttp && LOCAL_HOSTS.includes(url.hostname)) return url.origin;
  throw new Error(`content-security-policy: refusing non-https browser origin ${url.origin}`);
}

// PC-J597: the browser SDK posts envelopes to its DSN host only. Listed when a
// DSN is built in, as that exact https origin (no region wildcard); a malformed
// DSN fails the build like any other unusable origin.
export const SENTRY_DSN_ENV = 'NEXT_PUBLIC_SENTRY_DSN';

export function sentryConnectSource(env = process.env) {
  const dsn = (env[SENTRY_DSN_ENV] || '').trim();
  if (!dsn) return null;
  let url;
  try {
    url = new URL(dsn);
  } catch {
    // Not echoed: the DSN is public once built, but not a value for build logs.
    throw new Error(`content-security-policy: ${SENTRY_DSN_ENV} is not a valid URL`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`content-security-policy: ${SENTRY_DSN_ENV} must be an https:// DSN`);
  }
  return url.origin;
}

function connectSources(env) {
  const vercelEnv = env.VERCEL_ENV || '';
  const origins = resolveRuntimeOrigins(env);
  // Loopback http is for local machines only: no VERCEL_ENV, or the
  // documented local dev setup (README / agent launcher) that sets
  // VERCEL_ENV=development. Vercel deployments are only ever `preview` or
  // `production`, and those stay https-only.
  const allowLocalHttp = !vercelEnv || vercelEnv === 'development';

  // Local fixture builds only (never a Vercel build): browser verifiers swap
  // runtime-config.js for arbitrary fixture origins and intercept them, and
  // CSP is enforced before Playwright request interception.
  if (!vercelEnv && env.AVER_ENVIRONMENT === 'test') {
    const sources = ["'self'", 'https:', 'wss:'];
    if (origins.apiBase) {
      try {
        const api = new URL(origins.apiBase);
        if (api.protocol === 'http:' && LOCAL_HOSTS.includes(api.hostname)) sources.push(api.origin);
      } catch { /* the generator owns apiBase validation for fixture builds */ }
    }
    return sources;
  }

  // Unconfigured local builds keep api.js / page-level legacy inference:
  // localhost:8000 or the production API, and the production Supabase project.
  const apiBases = origins.apiBase ? [origins.apiBase] : [LEGACY_LOCAL_API_ORIGIN, PROD.apiBase];
  const supabaseUrl = origins.supabaseUrl || PROD.supabaseUrl;
  const sources = ["'self'", ...apiBases, supabaseUrl].map((value) =>
    value === "'self'" ? value : browserOrigin(value, { allowLocalHttp }));
  const sentry = sentryConnectSource(env);
  if (sentry) sources.push(sentry);
  if (vercelEnv && vercelEnv !== 'production') sources.push(...VERCEL_TOOLBAR_SOURCES.connect);
  return [...new Set(sources)];
}

/** The full policy string for the build described by `env`. */
export function buildContentSecurityPolicy(env = process.env) {
  const vercelEnv = env.VERCEL_ENV || '';
  const toolbar = Boolean(vercelEnv) && vercelEnv !== 'production';
  const extra = (kind) => (toolbar ? VERCEL_TOOLBAR_SOURCES[kind] : []);

  const directives = [
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    // 'unsafe-inline' stays: App Router streams inline RSC bootstrap scripts
    // on every page and nonces would force all routes dynamic (see doc).
    ['script-src', ["'self'", "'unsafe-inline'", ...(env.NODE_ENV === 'development' ? ["'unsafe-eval'"] : []), ...extra('script')]],
    ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', ...extra('style')]],
    ['font-src', ["'self'", 'data:', 'https://fonts.gstatic.com', ...extra('font')]],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
    ['media-src', ["'self'", 'blob:', 'https:']],
    ['connect-src', connectSources(env)],
    ...(toolbar ? [['frame-src', ["'self'", ...VERCEL_TOOLBAR_SOURCES.frame]]] : []),
    ['form-action', ["'self'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

// SEC-CSP-NONCE step 1 (PC-J38): a per-request nonce + 'strict-dynamic'
// script-src, sent as Content-Security-Policy-Report-Only by proxy.ts on the
// signed-in route groups. The enforced policy above is unchanged.
export const NONCE_REPORT_ONLY_FLAG = 'AVER_CSP_NONCE_REPORT_ONLY';
export const NONCE_ENFORCE_FLAG = 'AVER_CSP_NONCE_ENFORCE';

/** Step 2 is opt-in, and cannot be enabled in a Vercel production build. */
export function nonceEnforceEnabled(env = process.env) {
  return env[NONCE_ENFORCE_FLAG] === '1' && env.VERCEL_ENV !== 'production';
}

/**
 * Whether this build renders the AuthedShell routes per request with a nonce.
 * `AVER_CSP_NONCE_REPORT_ONLY=1|0` decides; otherwise every build except a
 * Vercel production build is on. Production stays static until the owners
 * enable it from the staging measurements.
 */
export function nonceReportOnlyEnabled(env = process.env) {
  // This flag also controls AuthedShell's request-time nonce read. Enforcing
  // must enable that read even when Report-Only was explicitly switched off.
  if (nonceEnforceEnabled(env)) return true;
  const flag = env[NONCE_REPORT_ONLY_FLAG];
  if (flag === '1') return true;
  if (flag === '0') return false;
  return env.VERCEL_ENV !== 'production';
}

/**
 * Only script-src is under evaluation. Every other directive is already
 * enforced, identically, by the blocking header; repeating them here would
 * only report the same violation twice. 'unsafe-inline' is the CSP2 fallback:
 * browsers that honour a nonce ignore it.
 */
export function buildNonceReportOnlyPolicy(nonce, env = process.env) {
  if (!/^[A-Za-z0-9+/]{16,}={0,2}$/.test(nonce || '') || /\s/.test(nonce)) {
    throw new Error('content-security-policy: nonce must be base64 of >= 12 random bytes');
  }
  const sources = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'unsafe-inline'"];
  if (env.NODE_ENV === 'development') sources.push("'unsafe-eval'");
  return `script-src ${sources.join(' ')}`;
}

/** Full blocking policy: change only script-src from the existing baseline. */
export function buildNonceEnforcedPolicy(nonce, env = process.env) {
  const script = buildNonceReportOnlyPolicy(nonce, env);
  const toolbar = env.VERCEL_ENV && env.VERCEL_ENV !== 'production'
    ? ` ${VERCEL_TOOLBAR_SOURCES.script.join(' ')}` : '';
  return buildContentSecurityPolicy(env).replace(/script-src [^;]+/, `${script}${toolbar}`);
}

/** Runtime defense in addition to the proxy's production-host exclusion. */
export function nonceHostAllowed(hostname) {
  return hostname === 'staging.averlearning.com'
    || hostname === 'localhost' || hostname === '127.0.0.1'
    || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(hostname);
}

// Next requires a literal matcher in proxy.ts. The route inventory tests keep
// this runtime guard aligned with that matcher and every AuthedShell layout.
export function nonceRouteAllowed(pathname) {
  return /^\/(?:admin|advanced-vocabulary|course-exercises|d1-exercise|exam|exercises|flashcard-study|flashcards|full-test|full-test-result|grammar-checkup|grammar-lessons|home|instructor|listening|mock|mock-exam|my-class|onboarding|practice|profile|quiz|reading|result|speaking|writing)(?:\/|$)/.test(pathname)
    || /^\/vocabulary\/.+/.test(pathname);
}

// PC-J566 / SA-1029-CSP1 F1 (b): the build's own route table for the nonce
// prefixes, inlined by next.config.ts (tooling/nonce-route-table.mjs walks
// app/). A URL no entry matches is answered by the static root
// `/_not-found` (HTTP 404), whose scripts can never carry a request nonce, so
// the proxy leaves it on the public baseline. A missing or malformed table
// keeps the nonce policy on every prefixed URL (the pre-PC-J566 behavior).
export const NONCE_ROUTE_TABLE_ENV = 'AVER_CSP_NONCE_ROUTES';

/** Route patterns from the inlined table, or null when it is unusable. */
export function parseNonceRouteTable(value) {
  try {
    const table = JSON.parse(value || '');
    return Array.isArray(table) && table.length > 0
      && table.every((route) => typeof route === 'string' && route.startsWith('/')) ? table : null;
  } catch {
    return null;
  }
}

function segmentMatches(pattern, segment) {
  return /^\[[^\].]+\]$/.test(pattern) ? segment !== '' : pattern === segment;
}

/**
 * Whether Next answers `pathname` from a route in `table` rather than the root
 * not-found page. Segments are compared as sent (still percent-encoded), as
 * Next routes them: `/admin/cl%61sses` is a 404 there, not `/admin/classes`.
 * Only a dynamic segment accepts any non-empty value. An unusable table counts
 * every URL as a route (keeps the nonce).
 */
export function nonceRouteExists(pathname, table) {
  if (!table) return true;
  const segments = pathname.split('/').slice(1);
  return table.some((route) => {
    const parts = route === '/' ? [] : route.split('/').slice(1);
    const last = parts.at(-1) ?? '';
    const optional = /^\[\[\.\.\.[^\]]+\]\]$/.test(last);
    const catchAll = optional || /^\[\.\.\.[^\]]+\]$/.test(last);
    const fixed = catchAll ? parts.slice(0, -1) : parts;
    if (catchAll ? segments.length < fixed.length + (optional ? 0 : 1) : segments.length !== fixed.length) return false;
    if (catchAll && segments.slice(fixed.length).some((segment) => segment === '')) return false;
    return fixed.every((pattern, i) => segmentMatches(pattern, segments[i]));
  });
}

// These are the nonce routes from next.config.ts's framing allowlist. Exact
// matches preserve its existing policy (children keep frame-ancestors none).
export const NONCE_SAME_ORIGIN_FRAME_ROUTES = Object.freeze([
  '/listening/test/session', '/reading/exam/session',
  '/admin/mock-exams', '/admin/mock-live', '/admin/mock-reviews',
  '/admin/writing/queue', '/admin/writing/status', '/admin/writing/grade',
]);

/** Same policy for the allow-listed same-origin embeddable workspaces. */
export function sameOriginFramePolicy(policy) {
  return policy.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
}
