// Writing samples list (LIBRARY-0061 T009 = G06-T09; FR-010, FR-011, FR-012).
//
// Pure helpers shared by the server page and its client filters, so the URL,
// the API query and the rendered state are derived the same way everywhere.
// URL parameters (FR-010): task, dang, chude, q, trang.

export const PAGE_SIZE = 12;
export const SEARCH_DEBOUNCE_MS = 300;
export const Q_MAX_LENGTH = 100;
export const LIST_PATH = '/library/writing-samples';

export const TASKS = Object.freeze(['task2', 'task1']);
export const TASK_LABELS = Object.freeze({ task2: 'Task 2', task1: 'Task 1' });

// Public question-type codes and labels, as `routers/library.py` returns them.
// Stored codes such as `problem_solution` never reach the page (FR-015).
export const QUESTION_TYPES = Object.freeze([
  Object.freeze({ code: 'opinion', label: 'Opinion', gloss: 'nêu quan điểm' }),
  Object.freeze({ code: 'discussion', label: 'Discussion', gloss: 'bàn hai quan điểm' }),
  Object.freeze({ code: 'problem-solution', label: 'Problem and Solution', gloss: 'nguyên nhân, giải pháp' }),
  Object.freeze({ code: 'advantages-disadvantages', label: 'Advantages and Disadvantages', gloss: 'lợi và hại' }),
  Object.freeze({ code: 'two-part', label: 'Two-part Question', gloss: 'hai câu hỏi' }),
  Object.freeze({ code: 'positive-negative', label: 'Positive or Negative Development', gloss: 'tích cực hay tiêu cực' }),
]);
const TYPE_CODES = new Set(QUESTION_TYPES.map((t) => t.code));
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * URL parameters → a valid query. Anything the API would reject is dropped
 * (an unknown task or type, `dang` with Task 1, a non-slug topic), so a hand
 * edited link still opens a working list instead of an error.
 */
export function parseListQuery(params) {
  const source = params ?? {};
  const rawTask = first(source.task);
  const task = TASKS.includes(rawTask) ? rawTask : null;
  const rawType = first(source.dang);
  const dang = task !== 'task1' && TYPE_CODES.has(rawType) ? rawType : null;
  const rawTopic = first(source.chude);
  const chude = typeof rawTopic === 'string' && SLUG.test(rawTopic) ? rawTopic : null;
  const q = String(first(source.q) ?? '').trim().slice(0, Q_MAX_LENGTH);
  const page = Number.parseInt(String(first(source.trang) ?? ''), 10);
  const trang = Number.isFinite(page) && page >= 1 ? page : 1;
  return Object.freeze({ task, dang, chude, q, trang });
}

function searchString(query, { includeDefaultPage = false } = {}) {
  const out = new URLSearchParams();
  if (query.task) out.set('task', query.task);
  if (query.dang) out.set('dang', query.dang);
  if (query.chude) out.set('chude', query.chude);
  if (query.q) out.set('q', query.q);
  if (query.trang > 1 || includeDefaultPage) out.set('trang', String(query.trang));
  const text = out.toString();
  return text ? `?${text}` : '';
}

/** Page URL of a query; page 1 is left out so the plain list has one address. */
export function listHref(query) {
  return `${LIST_PATH}${searchString(query)}`;
}

/** Backend path of a query (`GET /api/library/writing-samples`). */
export function listApiPath(query) {
  return `/api/library/writing-samples${searchString(query)}`;
}

/**
 * A filter change. Every change goes back to page 1 (FR-011), and choosing
 * Task 1 drops the Task 2 question type (FR-010). `trang` alone moves pages.
 */
export function changeListQuery(query, change) {
  if (Object.keys(change).length === 1 && 'trang' in change) {
    return Object.freeze({ ...query, trang: Math.max(1, Number(change.trang) || 1) });
  }
  const next = { ...query, ...change, trang: 1 };
  if (next.task === 'task1') next.dang = null;
  if ('q' in change) next.q = String(change.q ?? '').trim().slice(0, Q_MAX_LENGTH);
  return Object.freeze(next);
}

export function hasFilters(query) {
  return Boolean(query.task || query.dang || query.chude || query.q);
}

export function clearedQuery() {
  return Object.freeze({ task: null, dang: null, chude: null, q: '', trang: 1 });
}

export function totalPages(total) {
  return Math.max(1, Math.ceil((Number(total) || 0) / PAGE_SIZE));
}

/** Row number counted within the filtered result (FR-011). */
export function rowNumber(page, index) {
  return (Math.max(1, page) - 1) * PAGE_SIZE + index + 1;
}

/**
 * The count line: "549 đề", "479 đề Task 2", "Không có đề nào khớp". A count
 * the API did not send is never shown as 0.
 */
export function countText(total, query) {
  if (typeof total !== 'number') return '';
  if (total === 0) return '0 đề khớp';
  const scope = query.task ? ` ${TASK_LABELS[query.task]}` : '';
  return `${total.toLocaleString('vi-VN')} đề${scope}${hasFilters({ ...query, task: null }) ? ' khớp' : ''}`;
}

export function questionTypeLabel(code) {
  return QUESTION_TYPES.find((t) => t.code === code)?.label ?? null;
}

/** Active filters as removable chips, in the order of the filter column. */
export function activeChips(query, topics) {
  const chips = [];
  if (query.task) chips.push({ key: 'task', label: TASK_LABELS[query.task], change: { task: null } });
  if (query.dang) chips.push({ key: 'dang', label: questionTypeLabel(query.dang) ?? query.dang, change: { dang: null } });
  if (query.chude) {
    const topic = (topics ?? []).find((t) => t.slug === query.chude);
    chips.push({ key: 'chude', label: topic?.label_vi || query.chude, change: { chude: null } });
  }
  if (query.q) chips.push({ key: 'q', label: `“${query.q}”`, change: { q: '' } });
  return chips;
}

/**
 * Read the list for a query and decide what the page shows (FR-011).
 * `fetchList(apiPath)` resolves to `{ data, status }` (`data` null on any
 * failure, `status` the HTTP code or null when there was no answer).
 *
 * - A topic the API no longer knows (422 with `chude`) is not a server
 *   failure: read again without it and say so (`notice: 'topic-gone'`).
 *   "Tải lại" would otherwise repeat the same refused query forever.
 * - A page past the end of a non-empty result (`?trang=99`) goes to the last
 *   page (`redirectTo`) instead of an empty state that blames the filters.
 */
export async function loadListState(query, fetchList) {
  let shown = query;
  let notice = null;
  let { data, status } = await fetchList(listApiPath(shown));
  if (status === 422 && shown.chude) {
    shown = Object.freeze({ ...shown, chude: null, trang: 1 });
    notice = 'topic-gone';
    ({ data } = await fetchList(listApiPath(shown)));
  }
  if (data && data.total > 0 && Array.isArray(data.items) && data.items.length === 0 && shown.trang > 1) {
    const last = totalPages(data.total);
    if (last < shown.trang) {
      return { query: shown, data, notice, redirectTo: listHref({ ...shown, trang: last }) };
    }
  }
  return { query: shown, data, notice, redirectTo: null };
}
