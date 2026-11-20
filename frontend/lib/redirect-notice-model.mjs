// G02-T11 (FR-02-010) — "đưa về trang cha" notices.
//
// A page opened without the parameter it needs sends the visitor to its parent
// page with `?notice=<key>`; the parent shows one plain sentence and drops the
// parameter. The page NAME comes from this table keyed by the parent's own
// pathname, never from the URL: an outsider can edit a query string, so a
// `from_label` would let anyone print arbitrary text on our page.

export const NOTICE_PARAM = 'notice';

export const NOTICE_KEYS = Object.freeze({
  missing: 'lien-ket-thieu',
  notFound: 'khong-tim-thay',
});

const MESSAGES = Object.freeze({
  'lien-ket-thieu': (label) => `Liên kết bạn vừa mở chưa đủ thông tin nên bạn được đưa về ${label}.`,
  'khong-tim-thay': (label) => `Không tìm thấy nội dung bạn muốn mở nên bạn được đưa về ${label}.`,
});

/** Parent pages a redirect may land on, by pathname (no trailing slash). */
export const PARENT_LABELS = Object.freeze({
  '/speaking': 'trang Speaking',
  '/full-test': 'trang Thi thử',
  '/writing/dashboard': 'trang Writing',
  '/grammar': 'Grammar Wiki',
  '/listening': 'trang Listening',
  '/listening/practice': 'trang luyện nghe',
  '/reading/test': 'trang Reading',
  '/grammar/exercises': 'trang bài tập ngữ pháp',
  '/vocabulary/hub': 'trang Từ vựng',
  '/my-class': 'trang Lớp học',
  '/instructor': 'trang Giảng dạy',
  '/admin/mock-tests': 'trung tâm Mock Test',
  // G02-T12: admin parents.
  '/admin/reading/content': 'trang nội dung Reading',
  '/admin/classes': 'trang Lớp',
  '/admin/writing/queue': 'hàng chờ chấm Writing',
  '/admin/writing/instructor-queue': 'hàng chờ của giảng viên',
});

const FALLBACK_LABEL = 'trang này';

/**
 * The sentence for a notice key shown on `pathname`, or null for an unknown
 * key (nothing is shown for a key we did not write).
 * @param {unknown} key @param {unknown} pathname
 * @returns {string | null}
 */
export function redirectNoticeMessage(key, pathname) {
  if (typeof key !== 'string' || !Object.hasOwn(MESSAGES, key)) return null;
  const path = typeof pathname === 'string' ? (pathname.replace(/\/+$/, '') || '/') : '';
  const label = Object.hasOwn(PARENT_LABELS, path) ? PARENT_LABELS[path] : FALLBACK_LABEL;
  return MESSAGES[key](label);
}

/**
 * `parent` with `?notice=<key>` added, keeping any query the parent already has.
 * @param {string} parent a same-origin path such as `/speaking` or `/a?tab=b`
 * @param {string} [key]
 */
export function redirectNoticeHref(parent, key = NOTICE_KEYS.missing) {
  // A backslash reads as `/` in browsers, so `/\\evil` would leave the site.
  if (typeof parent !== 'string' || !parent.startsWith('/') || parent.startsWith('//') || parent.includes('\\')) {
    throw new Error('redirect-notice-parent-must-be-a-path');
  }
  if (!Object.hasOwn(MESSAGES, key)) throw new Error('redirect-notice-unknown-key');
  const [pathAndQuery, hash = ''] = parent.split('#', 2);
  const [path, query = ''] = pathAndQuery.split('?', 2);
  const params = new URLSearchParams(query);
  params.set(NOTICE_PARAM, key);
  return `${path}?${params.toString()}${hash ? `#${hash}` : ''}`;
}

/**
 * A required query value from a Server Component's `searchParams`, trimmed;
 * '' when absent. A repeated parameter counts by its first value, as
 * `URLSearchParams.get` does in the client component that uses it.
 * @param {string | string[] | undefined} value
 */
export function searchParamText(value) {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.trim() : '';
}

/**
 * A `searchParams` object with each repeated parameter cut to its first value,
 * for the href builders that expect one value per name.
 * @param {Record<string, string | string[] | undefined>} params
 * @returns {Record<string, string | undefined>}
 */
export function firstSearchParams(params) {
  return Object.fromEntries(Object.entries(params || {}).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

/**
 * Read and drop the notice from a `location.search`.
 * @param {string} search
 * @returns {{ key: string | null, search: string }} the key and the remaining search ('' or '?…')
 */
export function takeRedirectNotice(search) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const key = params.get(NOTICE_PARAM);
  if (key === null) return { key: null, search: typeof search === 'string' ? search : '' };
  params.delete(NOTICE_PARAM);
  const rest = params.toString();
  return { key, search: rest ? `?${rest}` : '' };
}

/**
 * Client pages that read their parameter in the browser: leave for the parent
 * with the notice (replace, so Back does not return to the broken link).
 * @param {string} parent @param {string} [key] @param {{ replace(url: string): void }} [location]
 */
export function leaveForParent(parent, key = NOTICE_KEYS.missing, location = globalThis.location) {
  location.replace(redirectNoticeHref(parent, key));
}
