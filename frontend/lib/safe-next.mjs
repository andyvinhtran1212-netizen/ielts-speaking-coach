// G02-T15 (FR-02-013) — where a learner returns after signing in.
//
// `next` comes from the address bar or from document.referrer, both of which an
// outsider can shape, so only a same-origin path survives. Mirrors the steps of
// `sanitizeAdminNext` (lib/admin-mfa-model.mjs) without its `/admin/` prefix
// rule; the two stay separate on purpose.

const PROBE_ORIGIN = 'https://learner-next.invalid';

// Destinations that would loop or bounce: the login page itself, onboarding
// (decided by the profile, not by `next`), the admin MFA gate, and the public
// landing root (a visitor who came from `/` keeps the default `/home`).
const REFUSED_PATHS = new Set(['/', '/login', '/onboarding', '/admin/mfa']);

export const LOGIN_NEXT_STORAGE_KEY = 'av-login-next';

/** @returns {string | null} a same-origin `pathname + search + hash`, or null. */
export function sanitizeLearnerNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null;
  // Backslashes and control characters are normalised differently by browsers.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let url;
  try { url = new URL(raw, PROBE_ORIGIN); } catch { return null; }
  if (url.origin !== PROBE_ORIGIN) return null;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (REFUSED_PATHS.has(path)) return null;
  if ([...REFUSED_PATHS].some((refused) => refused !== '/' && path.startsWith(`${refused}/`))) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The page a visitor was trying to open when they reached /login: an explicit
 * `?next=` wins; otherwise a same-origin referrer (the signed-out guards use
 * `location.replace('/login')`, which keeps the referrer under the site's
 * strict-origin-when-cross-origin policy).
 * @param {{ search?: string, referrer?: string, origin: string }} input
 * @returns {string | null}
 */
export function resolveLoginNext({ search = '', referrer = '', origin }) {
  const explicit = new URLSearchParams(search).get('next');
  if (explicit !== null) return sanitizeLearnerNext(explicit);
  if (!referrer || typeof origin !== 'string') return null;
  let ref;
  try { ref = new URL(referrer); } catch { return null; }
  if (ref.origin !== origin) return null;
  return sanitizeLearnerNext(`${ref.pathname}${ref.search}${ref.hash}`);
}
