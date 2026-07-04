/**
 * Shared performance resource hints for authenticated chrome surfaces.
 *
 * Installed by <aver-chrome> and <aver-admin-chrome>. JS injection lets us
 * honor Save-Data users instead of forcing preconnect sockets on constrained
 * connections.
 */

// The API origin is derived from the canonical window.api.base (api.js) so the
// host never drifts from the real API base. The literal is kept only as a
// fallback for the brief window before api.js has run. supabase/cloudinary are
// third-party origins (not the API base) and stay static.
const API_ORIGIN_FALLBACK = 'https://ielts-speaking-coach-production.up.railway.app';
const STATIC_ORIGINS = [
  'https://huwsmtubwulikhlmcirx.supabase.co',
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

function perfOrigins() {
  return [apiOrigin(), ...STATIC_ORIGINS];
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
