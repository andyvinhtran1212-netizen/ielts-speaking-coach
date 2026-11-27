// LIBRARY-0061 T020 (G06-T20): pure helpers for /admin/library.
// The page renders only what these normalizers accept; a malformed server
// answer becomes an error state, never an empty table.

export const TABS = Object.freeze([
  { id: 'writing', label: 'Bài mẫu Writing', live: true },
  { id: 'speaking', label: 'Đề Speaking', live: true },
  { id: 'import', label: 'Lô nhập', live: true },
  { id: 'shelves', label: 'Kệ và bài nổi bật', live: false },
  { id: 'seo', label: 'SEO', live: false },
]);
const TAB_IDS = new Set(TABS.map((tab) => tab.id));
const STATUSES = new Set(['all', 'published', 'draft']);
export const TITLE_MIN = 3;
export const TITLE_MAX = 70;
export const BULK_MAX = 50;

const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

export function normalizeTab(value) {
  return TAB_IDS.has(value) ? value : 'writing';
}

/** URL search params → filters for one shelf (unknown values fall back). */
export function normalizeLibraryFilters(shelf, input = {}) {
  const status = STATUSES.has(input.status) ? input.status : 'all';
  const q = typeof input.q === 'string' ? input.q.trim().slice(0, 100) : '';
  const topic = typeof input.topic === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.topic) ? input.topic : '';
  const pageNumber = Number.parseInt(String(input.page ?? ''), 10);
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 1000 ? pageNumber : 1;
  const base = { status, q, topic, page };
  if (shelf === 'speaking') {
    const part = ['1', '2', '3'].includes(String(input.part ?? '')) ? String(input.part) : '';
    return { ...base, part };
  }
  const task = input.task === 'task2' || input.task === 'task1' ? input.task : '';
  return { ...base, task };
}

/** Filters → backend query string (empty values omitted, page 1 omitted). */
export function libraryQuery(shelf, filters) {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (shelf === 'speaking' ? filters.part : filters.task) {
    params.set(shelf === 'speaking' ? 'part' : 'task', shelf === 'speaking' ? filters.part : filters.task);
  }
  if (filters.topic) params.set('topic', filters.topic);
  if (filters.q) params.set('q', filters.q);
  if (filters.page > 1) params.set('page', String(filters.page));
  return params.toString();
}

function normalizeBlockers(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const item of raw) {
    const b = record(item);
    const code = text(b?.code);
    const message = text(b?.message);
    if (!code || !message) return null;
    out.push({ code, message });
  }
  return out;
}

function normalizeRow(shelf, raw) {
  const row = record(raw);
  if (!row) return null;
  const id = text(row.id);
  const slug = text(row.slug);
  const title = typeof row.title_en === 'string' ? row.title_en : null;
  const blockers = normalizeBlockers(row.blockers);
  if (!id || !slug || title === null || typeof row.published !== 'boolean' || !blockers) return null;
  const common = {
    id, slug, titleEn: title, topicSlug: text(row.topic_slug), published: row.published,
    publishedAt: text(row.published_at), updatedAt: text(row.updated_at), blockers,
  };
  if (shelf === 'speaking') {
    if (![1, 2, 3].includes(row.part)) return null;
    return {
      ...common, part: row.part, titleVi: text(row.title_vi), videoSource: text(row.video_source),
      durationS: Number.isInteger(row.duration_s) && row.duration_s > 0 ? row.duration_s : null,
      hasAudio: row.has_audio === true,
    };
  }
  if (!['task2', 'task1_academic'].includes(row.task_type)) return null;
  return {
    ...common, taskType: row.task_type, questionType: text(row.question_type), task1Subtype: text(row.task1_subtype),
  };
}

/** Server list answer → view model, or null when the shape is wrong. */
export function normalizeLibraryList(shelf, raw) {
  const source = record(raw);
  if (!source || !Array.isArray(source.items) || !Array.isArray(source.topics)) return null;
  const counts = record(source.counts);
  const all = count(counts?.all);
  const published = count(counts?.published);
  const draft = count(counts?.draft);
  const total = count(source.total);
  const page = count(source.page);
  const pageSize = count(source.page_size);
  if (all === null || published === null || draft === null || published + draft !== all) return null;
  if (total === null || !page || !pageSize) return null;
  const items = [];
  for (const item of source.items) {
    const row = normalizeRow(shelf, item);
    if (!row) return null;
    items.push(row);
  }
  const topics = [];
  for (const item of source.topics) {
    const t = record(item);
    const slug = text(t?.slug);
    if (!slug) return null;
    topics.push({ slug, label: text(t.label_vi) || slug });
  }
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)), counts: { all, published, draft }, topics };
}

/** Publish/unpublish answer → view model, or null when the shape is wrong. */
export function normalizePublishResult(raw) {
  const source = record(raw);
  if (!source || !Array.isArray(source.changed) || !Array.isArray(source.unchanged) || !Array.isArray(source.rejected)) return null;
  if (typeof source.audit_logged !== 'boolean') return null;
  const rejected = [];
  for (const item of source.rejected) {
    const r = record(item);
    const id = text(r?.id);
    const reasons = normalizeBlockers(r?.reasons);
    if (!id || !reasons || !reasons.length) return null;
    rejected.push({ id, slug: text(r.slug), reasons });
  }
  if (![...source.changed, ...source.unchanged].every((id) => typeof id === 'string' && id)) return null;
  return { changed: source.changed, unchanged: source.unchanged, rejected, auditLogged: source.audit_logged };
}

/** True when the string carries Vietnamese marks (same rule as the backend). */
export function hasVietnameseMarks(value) {
  const s = String(value ?? '');
  if (s.toLowerCase().includes('đ')) return true;
  return /\p{M}/u.test(s.normalize('NFD'));
}

/** Client pre-check for the quick-edit title (the server re-checks). */
export function titleProblem(shelf, value) {
  const title = String(value ?? '').trim();
  if (!title) return 'Nhập tiêu đề tiếng Anh.';
  if (shelf === 'writing' && (title.length < TITLE_MIN || title.length > TITLE_MAX)) {
    return `Tiêu đề dài ${TITLE_MIN}–${TITLE_MAX} ký tự (hiện ${title.length}).`;
  }
  if (hasVietnameseMarks(title)) return 'Tiêu đề tiếng Anh không có dấu tiếng Việt.';
  return null;
}

export function publishSummary(result, { published }) {
  const verb = published ? 'Đã đăng' : 'Đã gỡ';
  const parts = [`${verb} ${result.changed.length} mục`];
  if (result.unchanged.length) parts.push(`${result.unchanged.length} mục không đổi`);
  if (result.rejected.length) parts.push(`${result.rejected.length} mục bị loại`);
  return parts.join(' · ');
}
