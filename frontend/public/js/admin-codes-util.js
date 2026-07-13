/**
 * frontend/js/admin-codes-util.js — Sprint 17.1 (Direction A)
 *
 * Pure helpers for the access-codes admin table: quota display, client-side
 * search (code + assigned email), and column sort comparator. Side-effect-free
 * + ES-exported so they're unit-testable in node (the controller
 * admin-access-codes.js imports them; it stays DOM-coupled and untested directly).
 *
 * Client-side by design: the codes roster is admin-scale (<1000) and the page
 * already filters client-side; server-side pagination is a future switch.
 */

// Status sort rank: active (0) < locked (1) < revoked (2).
export function statusRank(code) {
  if (!code) return 0;
  if (code.is_revoked) return 2;
  if (code.is_active === false) return 1;
  return 0;
}

// quota block { used, limit, remaining, limit_type } → VN display string ('' if absent).
export function quotaLabel(quota) {
  if (!quota || typeof quota !== 'object') return '';
  const used = quota.used == null ? 0 : quota.used;
  if (quota.limit == null || quota.limit_type === 'unlimited') {
    return `${used} / ∞`;
  }
  const remaining = quota.remaining == null ? Math.max(0, quota.limit - used) : quota.remaining;
  return `${used}/${quota.limit} · còn ${remaining}`;
}

// Client-side search over code value + any assigned user's email (case-insensitive).
export function codeMatchesSearch(code, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  if ((code.code || '').toLowerCase().includes(q)) return true;
  return (code.assigned_users || []).some(
    (u) => (u && u.email ? u.email.toLowerCase() : '').includes(q)
  );
}

// Comparator for sortable columns: created_at | expires_at | status.
// NULL timestamps sort last regardless of direction (mirrors GET /sessions nullsfirst=false).
export function compareCodesBy(field, order) {
  const dir = order === 'asc' ? 1 : -1;
  return (a, b) => {
    if (field === 'status') {
      return (statusRank(a) - statusRank(b)) * dir;
    }
    const av = a[field] ? new Date(a[field]).getTime() : null;
    const bv = b[field] ? new Date(b[field]).getTime() : null;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;   // nulls last
    if (bv === null) return -1;
    return (av - bv) * dir;
  };
}
