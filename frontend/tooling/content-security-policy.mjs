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

function connectSources(env) {
  const vercelEnv = env.VERCEL_ENV || '';
  const origins = resolveRuntimeOrigins(env);
  const allowLocalHttp = !vercelEnv;

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

/** Same policy for the allow-listed same-origin embeddable workspaces. */
export function sameOriginFramePolicy(policy) {
  return policy.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
}
