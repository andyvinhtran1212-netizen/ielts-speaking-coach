/**
 * Shared performance resource hints for authenticated chrome surfaces.
 *
 * Installed by <aver-chrome> and <aver-admin-chrome>. JS injection lets us
 * honor Save-Data users instead of forcing preconnect sockets on constrained
 * connections.
 */

// The API origin is derived from the canonical window.api.base (api.js) and
// the Supabase origin from the generated runtime config (js/runtime-config.js),
// so preview/staging pages never warm a connection to the PRODUCTION origins
// (zero-production-egress — plan §7.1). The literals are kept only as
// fallbacks for the unconfigured/local case. cloudinary is a static
// third-party origin.
const API_ORIGIN_FALLBACK = 'https://ielts-speaking-coach-production.up.railway.app';
const SUPABASE_ORIGIN_FALLBACK = 'https://huwsmtubwulikhlmcirx.supabase.co';
const STATIC_ORIGINS = [
  'https://res.cloudinary.com',
];

function apiOrigin() {
  try {
    if (window.api && window.api.base && /^https?:\/\//.test(window.api.base)) {
      return new URL(window.api.base).origin;
    }
  } catch { /* fall through to the literal */ }
  return API_ORIGIN_FALLBACK;
}

function supabaseOrigin() {
  try {
    const rc = window.__AVER_RUNTIME_CONFIG__;
    if (rc && rc.supabaseUrl) return new URL(rc.supabaseUrl).origin;
  } catch { /* fall through to the literal */ }
  return SUPABASE_ORIGIN_FALLBACK;
}

function perfOrigins() {
  return [apiOrigin(), supabaseOrigin(), ...STATIC_ORIGINS];
}


function hasResourceHint(rel, href) {
  return Boolean(document.head.querySelector(`link[rel="${rel}"][href="${href}"]`));
}


function appendHint(rel, href) {
  if (hasResourceHint(rel, href)) return;
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  if (rel === 'preconnect') link.crossOrigin = '';
  document.head.appendChild(link);
}


export function installPerfResourceHints() {
  if (navigator.connection && navigator.connection.saveData) return;
  perfOrigins().forEach((origin) => {
    appendHint('preconnect', origin);
    appendHint('dns-prefetch', origin);
  });
}


export { perfOrigins };
