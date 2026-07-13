/**
 * frontend/js/admin-usage-util.js — Sprint 17.2 (Direction B)
 *
 * Pure helpers for the usage-log admin views: cost/count formatting (graceful on
 * null when a sub-query degraded — Pattern #29), client-side search, and the sort
 * comparator. Side-effect-free + ES-exported so they're unit-testable in node
 * (admin-usage.js imports them; it stays DOM-coupled and source-scanned).
 */

// null (sub-query unavailable) → "—"; otherwise a USD string.
export function usdLabel(cost) {
  if (cost == null) return '—';
  const n = Number(cost);
  if (!isFinite(n)) return '—';
  return n === 0 ? '$0' : `$${n.toFixed(4)}`;
}

// null → "—"; otherwise the integer count.
export function countLabel(n) {
  return n == null ? '—' : String(n);
}

// "—" when missing; otherwise a vi-VN date.
export function lastActiveLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('vi-VN');
}

// Client-side search over name + email (case-insensitive).
export function userMatchesSearch(u, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  return (u.name || '').toLowerCase().includes(q)
      || (u.email || '').toLowerCase().includes(q);
}

// Comparator for sortable columns: name | sessions | last_active | ai_cost_usd.
// Null/missing metrics sort last regardless of direction (degraded data shouldn't
// jump to the top).
export function compareUsersBy(field, order) {
  const dir = order === 'asc' ? 1 : -1;
  return (a, b) => {
    if (field === 'name') {
      return (a.name || a.email || '').localeCompare(b.name || b.email || '') * dir;
    }
    let av = a[field];
    let bv = b[field];
    if (field === 'last_active') {
      av = av ? new Date(av).getTime() : null;
      bv = bv ? new Date(bv).getTime() : null;
    }
    if (av == null && bv == null) return 0;
    if (av == null) return 1;    // nulls last
    if (bv == null) return -1;
    return (av - bv) * dir;
  };
}
