// Incident inbox page model (ADMINIA-0074 FR-070…FR-073; plan 5.4; G09-T16).
// Plain ES module: URL state, labels, confirm/undo text and the note-only
// action rule. The API is G09-T07 (`/admin/incidents/groups…`).

export const SOURCES = Object.freeze(['errors', 'grading', 'feedback']);
export const SOURCE_LABEL = Object.freeze({ errors: 'Lỗi hệ thống', grading: 'Sự cố chấm bài', feedback: 'Phản hồi học viên' });
export const STATUSES = Object.freeze(['open', 'new', 'in_review', 'resolved', 'ignored', 'all']);
export const STATUS_FILTER_LABEL = Object.freeze({
  open: 'Chưa xử lý', new: 'Mới', in_review: 'Đang xem', resolved: 'Đã xử lý', ignored: 'Bỏ qua', all: 'Tất cả',
});
export const STATUS_LABEL = Object.freeze({ new: 'Mới', in_review: 'Đang xem', resolved: 'Đã xử lý', ignored: 'Bỏ qua' });
export const SORTS = Object.freeze(['learners', 'last', 'count']);
export const SORT_LABEL = Object.freeze({
  learners: 'Học viên bị ảnh hưởng nhiều nhất', last: 'Lần cuối mới nhất', count: 'Số lần nhiều nhất',
});
export const ACTION_LABEL = Object.freeze({
  claim: 'Nhận xử lý', resolve: 'Đánh dấu đã xử lý', ignore: 'Bỏ qua', reopen: 'Mở lại',
});
/** Where answer reports are handled until "Câu cần kiểm" (G09-T36) exists. */
export const REVIEW_QUEUE_HREF = '/admin/feedback';

/** @typedef {'claim' | 'resolve' | 'ignore' | 'reopen'} IncidentAction */

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * `{ source, status, sort, page }` from the query string; unknown values fall back.
 * @returns {{ source: string | null, status: string, sort: string, page: number }}
 */
export function parseInboxQuery(search = '') {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const page = Number.parseInt(q.get('page') || '1', 10);
  return {
    source: pick(q.get('source'), SOURCES, null),
    status: pick(q.get('status'), STATUSES, 'open'),
    sort: pick(q.get('sort'), SORTS, 'learners'),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/**
 * The query string for a state; defaults are left out so the plain URL stays plain.
 * @param {{ source?: string | null, status?: string, sort?: string, page?: number }} [state]
 */
export function inboxQueryString({ source = null, status = 'open', sort = 'learners', page = 1 } = {}) {
  const q = new URLSearchParams();
  if (source) q.set('source', source);
  if (status !== 'open') q.set('status', status);
  if (sort !== 'learners') q.set('sort', sort);
  if (page > 1) q.set('page', String(page));
  const text = q.toString();
  return text ? `?${text}` : '';
}

/** The API query of a state (`/admin/incidents/groups?…`). */
export function groupsApiQuery(state) {
  const q = new URLSearchParams({ status: state.status, sort: state.sort, page: String(state.page) });
  if (state.source) q.set('source', state.source);
  return q;
}

export function groupHref(group) {
  return `/admin/incidents/${group.source}/${group.fingerprint}`;
}

/** FR-072: a learner's name always links to their profile. */
export function learnerHref(ref) {
  return `/admin/learners/${encodeURIComponent(ref)}`;
}

const VN_TIME = { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };

/** "16/11 09:58" in Vietnam time; "—" when unknown. */
export function formatWhen(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('vi-VN', VN_TIME).formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`;
}

export function formatCount(value) {
  return Number.isInteger(value) ? value.toLocaleString('vi-VN') : '—';
}

/** Bulk refs carry what the page showed (G09-T07 conflict check). */
export function bulkRefs(groups) {
  return groups.map((g) => ({
    source: g.source, fingerprint: g.fingerprint, expected_count: g.count,
    ...(g.last_at ? { expected_last_at: g.last_at } : {}),
  }));
}

/** FR-071: the confirm box names the number of groups and of records. */
export function confirmText(action, groups) {
  const records = groups.reduce((n, g) => n + (Number.isInteger(g.count) ? g.count : 0), 0);
  const what = `${groups.length.toLocaleString('vi-VN')} nhóm (${records.toLocaleString('vi-VN')} lần ghi nhận)`;
  if (action === 'resolve') return `Chuyển ${what} sang Đã xử lý.`;
  if (action === 'ignore') return `Chuyển ${what} sang Bỏ qua.`;
  if (action === 'claim') return `Nhận xử lý ${what}.`;
  return `Mở lại ${what}.`;
}

/**
 * Only closing can be undone (reopen); "Nhận xử lý" has no way back in the API.
 * @returns {IncidentAction | null}
 */
export function undoActionFor(action) {
  return action === 'resolve' || action === 'ignore' ? 'reopen' : null;
}

/**
 * A note with no state change: the action that changes nothing for the
 * group's status (the API keeps a note even when the action is a no-op).
 * @returns {IncidentAction}
 */
export function noteOnlyAction(status) {
  if (status === 'resolved') return 'resolve';
  if (status === 'ignored') return 'ignore';
  return 'reopen';
}

/**
 * The actions a group in `status` offers on its detail page.
 * @returns {IncidentAction[]}
 */
export function actionsFor(status) {
  if (status === 'new') return ['claim', 'resolve', 'ignore'];
  if (status === 'in_review') return ['resolve', 'ignore'];
  return ['reopen'];
}

/** Plain words for the result of a bulk call. */
export function bulkResultText(action, out) {
  const changed = out?.changed ?? 0;
  const conflicts = Array.isArray(out?.conflicts) ? out.conflicts : [];
  const parts = [`${ACTION_LABEL[action]}: ${changed.toLocaleString('vi-VN')} nhóm.`];
  const moved = conflicts.filter((c) => c.code === 'count_changed').length;
  const gone = conflicts.filter((c) => c.code === 'not_found').length;
  const failed = conflicts.filter((c) => c.code === 'write_failed').length;
  if (moved) parts.push(`${moved} nhóm có ghi nhận mới nên chưa đổi; tải lại để xem.`);
  if (gone) parts.push(`${gone} nhóm không còn.`);
  if (failed) parts.push(`${failed} nhóm chưa ghi được; thử lại sau ít phút.`);
  if (out?.dismiss_failed?.length) parts.push('Một số dòng lỗi cũ chưa được đánh dấu; nhóm vẫn đã xử lý.');
  return parts.join(' ');
}
