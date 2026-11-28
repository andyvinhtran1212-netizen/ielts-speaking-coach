// Admin frame data (ADMINIA-0074 FR-001…FR-014; plan 5.1, 5.2; G09-T08).
// Plain ES module: turns the navigation registry and the GET /admin/attention
// counts into the StaffShell props, and holds the hidden-import banner rules.
// No React, so node:test covers it.

import { ADMIN_NAV_GROUPS, adminNavMatch, adminRouteFor, isHiddenImportRoute } from './admin-nav-registry.mjs';

/** The body class the server layout adds when ADMIN_FRAME_V2=1 (aver-admin-chrome.js reads it). */
export const ADMIN_FRAME_V2_BODY_CLASS = 'av-admin-frame-v2';

/** Role entries of the account menu (FR-003, FR-004): admin ⊃ instructor. */
export const ADMIN_SWITCH_TO = Object.freeze([
  { label: 'Sang khu học viên', href: '/home' },
  { label: 'Sang khu giáo viên', href: '/instructor' },
]);

/** The FR-013 banner copy. */
export const HIDDEN_IMPORT_COPY = Object.freeze({
  title: 'Trang nhập thủ công đã ẩn.',
  body: 'Nội dung nhập bằng script trên máy chủ.',
  open: 'Vẫn mở',
  back: 'Về trang nội dung',
});

/** sessionStorage key: "Vẫn mở" lasts for this tab, per route. */
export function hiddenImportKey(pattern) {
  return `av-hidden-import-open:${pattern}`;
}

/** The registry pattern of a hidden import page, or null. */
export function hiddenImportPattern(pathname) {
  return isHiddenImportRoute(pathname) ? adminRouteFor(pathname).pattern : null;
}

/** Where "Về trang nội dung" goes from a hidden import page. */
export function hiddenImportBack(pattern) {
  return String(pattern || '').startsWith('/admin/vocab') ? '/admin/vocab' : '/admin/listening';
}

/** Analytics event of a "Vẫn mở" click (POST /api/analytics/events). */
export function hiddenImportEvent(pattern) {
  return { event_name: 'admin_hidden_import_opened', event_data: { route: pattern } };
}

/**
 * `{ countKey: number | null }` from a GET /admin/attention body (plan 5.4:
 * `queues[key] = { count, error, unavailable, … }`). A queue that errored, is
 * unavailable or is missing gives no number, never 0.
 *
 * @param {unknown} body
 * @returns {Record<string, number | null>}
 */
export function attentionCounts(body) {
  const queues = body && typeof body === 'object' ? body.queues : null;
  /** @type {Record<string, number | null>} */
  const out = {};
  if (!queues || typeof queues !== 'object') return out;
  for (const [key, queue] of Object.entries(queues)) {
    const count = queue && typeof queue === 'object' ? queue.count : null;
    out[key] = Number.isInteger(count) && count >= 0 && !queue.error && !queue.unavailable ? count : null;
  }
  return out;
}

/**
 * StaffShell `nav` for the admin: the eight groups, each item with its href
 * (null while its page does not exist), `available` and the queue count.
 * An unavailable item never shows a number (FR-012).
 *
 * @param {Record<string, number | null>} [counts]
 * @returns {import('../components/ui/shell/staff-nav').StaffNavGroup[]}
 */
export function adminStaffNav(counts = {}, groups = ADMIN_NAV_GROUPS) {
  return groups.map((group) => ({
    id: group.id,
    label: group.label,
    icon: group.icon,
    items: group.items.map((item) => ({
      label: item.label,
      href: item.href,
      available: item.available,
      count: item.available && item.countKey ? (counts[item.countKey] ?? null) : null,
    })),
  }));
}

/**
 * The href StaffShell marks current (FR-007): the matched item's own href, so
 * /admin/writing/grade marks "Chấm bài › Writing". Null outside the registry
 * or when the matched item has no page yet.
 */
export function adminCurrentHref(pathname, search = '', groups = ADMIN_NAV_GROUPS) {
  const match = adminNavMatch(pathname, search);
  if (!match) return null;
  const group = groups.find((g) => g.id === match.groupId);
  const item = group?.items.find((i) => i.id === match.itemId);
  return item?.available ? item.href : null;
}

/** `?embed=1` pages (iframes inside other admin pages) get no frame. */
export function isEmbedSearch(search = '') {
  return new URLSearchParams(String(search || '').replace(/^\?/, '')).get('embed') === '1';
}

/** Initials for the account button: first letters of the first and last word. */
export function initialsOf(name) {
  const words = String(name || '').trim().split(/[\s@._-]+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}
