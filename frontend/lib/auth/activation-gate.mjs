// W-03 — client half of the activation gate.
//
// The backend is the real gate: every learner endpoint (services/
// activation_gate.py) and every staff endpoint (require_admin /
// require_instructor, Q-13) answers 403 for an account whose users.is_active
// is false. This module only keeps an inactive account from landing on a page
// that would render around those 403s; it sends them to /login, whose own
// /auth/me routing opens the access-code activation dialog.
//
// Staff consoles (/admin, /instructor) are gated too (Q-13): a staff role does
// not replace activation, and a direct visit never passes through /login.
// Only /login itself (no loop) and hybrid/public layouts, which mount
// AuthProvider without `activationGate`, are never redirected.

export const ACTIVATION_EXEMPT_PREFIXES = Object.freeze(['/login']);

const CACHE_PREFIX = 'aver-activation-confirmed:';

export function requiresActivation(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false;
  return !ACTIVATION_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Map a /auth/check-active outcome to the gate decision.
 *   'active'   → render the page
 *   'inactive' → replace('/login') (activation dialog)
 *   'unknown'  → FAIL OPEN: a transient network/5xx/garbled reply must not
 *                lock an active learner out; the backend still 403s every
 *                learner call for a truly inactive account.
 */
export function activationDecision(ok, payload) {
  if (!ok || !payload || typeof payload !== 'object' || typeof payload.is_active !== 'boolean') {
    return 'unknown';
  }
  return payload.is_active ? 'active' : 'inactive';
}

// Activation is one-way in this product (no flow clears users.is_active), so a
// per-tab "confirmed active" mark keyed by account skips the probe on later
// page loads in the same tab. It is a UX shortcut only, never authorization.
export function rememberActive(storage, userId) {
  try { storage?.setItem(CACHE_PREFIX + userId, '1'); } catch { /* optional */ }
}

export function isRememberedActive(storage, userId) {
  try { return storage?.getItem(CACHE_PREFIX + userId) === '1'; } catch { return false; }
}
