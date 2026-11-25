// Pure model of the Library sample page `/library/writing-samples/[slug]`
// (LIBRARY-0061 T010; tờ BaiMauWriting.dc.html, "Ghi chú cho lập trình").
// No React, no fetch: the page and its tests share these rules.

export const BANDS = Object.freeze(['7.5', '7.0', '6.0']);
export const PAIRS = Object.freeze([
  Object.freeze({ id: '7.5-7.0', high: '7.5', low: '7.0', delta: 'delta_75_70' }),
  Object.freeze({ id: '7.0-6.0', high: '7.0', low: '6.0', delta: 'delta_70_60' }),
]);
export const VIEWS = Object.freeze(['doc', 'so-sanh']);
export const DEFAULT_VIEW = Object.freeze({ xem: 'doc', muc: '7.5', cap: '7.5-7.0' });

/** @param {unknown} value */
function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * View state from the URL (FR-013): `xem` (doc | so-sanh), `muc` (band read
 * in "Đọc từng bài"), `cap` (pair compared). Anything else falls back to the
 * default "Đọc từng bài", band 7.5, pair 7.5 → 7.0.
 *
 * @param {Record<string, string | string[] | undefined> | null | undefined} params
 * @returns {{ xem: 'doc' | 'so-sanh', muc: string, cap: string }}
 */
export function pickViewState(params) {
  const p = params ?? {};
  const xem = first(p.xem);
  const muc = first(p.muc);
  const cap = first(p.cap);
  return {
    xem: /** @type {'doc' | 'so-sanh'} */ (VIEWS.includes(String(xem)) ? xem : DEFAULT_VIEW.xem),
    muc: BANDS.includes(String(muc)) ? String(muc) : DEFAULT_VIEW.muc,
    cap: PAIRS.some((pair) => pair.id === cap) ? String(cap) : DEFAULT_VIEW.cap,
  };
}

/**
 * Query string of a view state; default values are left out, so the default
 * view is the bare page URL.
 *
 * @param {{ xem: string, muc: string, cap: string }} state
 */
export function viewQuery(state) {
  const q = new URLSearchParams();
  if (state.xem !== DEFAULT_VIEW.xem) q.set('xem', state.xem);
  if (state.muc !== DEFAULT_VIEW.muc) q.set('muc', state.muc);
  if (state.cap !== DEFAULT_VIEW.cap) q.set('cap', state.cap);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** @param {unknown} value */
export function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Cut at a word boundary to at most `max` characters, with "…" when cut.
 * @param {string} text @param {number} max
 */
export function shorten(text, max) {
  const t = (text ?? '').trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/u, '')}…`;
}

/** Task number shown in titles: "Task 1" or "Task 2". @param {unknown} task */
export function taskLabel(task) {
  return task === 'task1' ? 'Task 1' : 'Task 2';
}

/**
 * The display title: `title_en`, else the start of the prompt (never a
 * Vietnamese name and never the slug, tờ "Mỗi đề có tiêu đề ngắn bằng tiếng Anh").
 * @param {{ title_en?: unknown, prompt_text?: unknown }} sample
 */
export function displayTitle(sample) {
  return clean(sample.title_en) ?? shorten(clean(sample.prompt_text) ?? 'IELTS Writing sample', 70);
}

/**
 * Metadata of plan §5.4.
 * @param {{ slug: string, title_en?: unknown, task?: unknown, prompt_text?: unknown }} sample
 */
export function sampleMetadata(sample) {
  const title = displayTitle(sample);
  const prompt = (clean(sample.prompt_text) ?? '').replace(/\s+/g, ' ');
  const lead = prompt.length > 150 ? prompt.slice(0, 150).trimEnd() : prompt;
  return {
    title: `${title} — IELTS Writing ${taskLabel(sample.task)}: bài mẫu 7.5, 7.0, 6.0 | Aver Learning`,
    description: `${lead}${lead ? ' ' : ''}Ba bài mẫu 7.5, 7.0, 6.0 kèm phân tích khác biệt.`,
    canonical: `/library/writing-samples/${sample.slug}`,
    ogTitle: title,
  };
}

// Paragraph roles of `outline[].function`. Only these known codes are shown
// as a label; any other short code is never printed (FR-015).
const PART_LABELS = {
  intro: 'Mở bài',
  introduction: 'Mở bài',
  overview: 'Tổng quan',
  body: 'Thân bài',
  body1: 'Thân bài 1',
  body_1: 'Thân bài 1',
  body2: 'Thân bài 2',
  body_2: 'Thân bài 2',
  body3: 'Thân bài 3',
  body_3: 'Thân bài 3',
  conclusion: 'Kết bài',
};

/** A free-text role is printed; a bare code (`lower_snake`, one word) only if known. @param {unknown} value */
function roleText(value) {
  const v = clean(value);
  if (!v) return null;
  const known = PART_LABELS[/** @type {keyof typeof PART_LABELS} */ (v.toLowerCase())];
  if (known) return { part: known, fn: null };
  if (/^[a-z0-9_-]+$/.test(v)) return null;
  return { part: null, fn: v };
}

/**
 * Role of paragraph `i` of `count` when the outline does not name it.
 * @param {number} i @param {number} count @param {unknown} task
 */
export function positionalPart(i, count, task) {
  if (i === 0) return 'Mở bài';
  if (task === 'task1') return i === 1 ? 'Tổng quan' : `Thân bài ${i - 1}`;
  if (count > 2 && i === count - 1) return 'Kết bài';
  return `Thân bài ${i}`;
}

/**
 * Rows of "Dàn ý" from the 7.5 essay outline: `{part, fn, ts}` per paragraph.
 * The outline is a list of objects (`paragraph`, `function`, `topic_sentence`,
 * …) or of plain strings.
 *
 * @param {unknown} outline @param {unknown} task
 * @returns {{ part: string, fn: string | null, ts: string | null }[]}
 */
export function outlineRows(outline, task) {
  const list = Array.isArray(outline) ? outline : [];
  const count = list.length;
  return list.flatMap((item, i) => {
    if (typeof item === 'string') {
      const text = clean(item);
      return text ? [{ part: positionalPart(i, count, task), fn: null, ts: text }] : [];
    }
    if (!item || typeof item !== 'object') return [];
    const role = roleText(/** @type {any} */ (item).function);
    const ts = clean(/** @type {any} */ (item).topic_sentence) ?? clean(/** @type {any} */ (item).summary);
    return [{ part: role?.part ?? positionalPart(i, count, task), fn: role?.fn ?? null, ts }];
  });
}

/**
 * "Đặc điểm chính" of a Task 1 set: `task1_data.key_features` (or
 * `main_features`), a list of strings. Missing → empty, and the section is
 * dropped from the contents (FR-016).
 *
 * @param {unknown} data
 * @returns {string[]}
 */
export function keyFeatures(data) {
  if (!data || typeof data !== 'object') return [];
  const raw = /** @type {any} */ (data).key_features ?? /** @type {any} */ (data).main_features;
  return Array.isArray(raw) ? raw.map(clean).filter((x) => x !== null) : [];
}

/**
 * Rows of "Từ vựng đáng học": the term inside the sentence of the essay when
 * that sentence contains it (`pre` / `hit` / `post`), else the sentence alone.
 *
 * @param {unknown} table
 */
export function vocabRows(table) {
  const list = Array.isArray(table) ? table : [];
  return list.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = /** @type {any} */ (item);
    const term = clean(row.term);
    if (!term) return [];
    const sentence = clean(row.sentence_in_essay);
    let pre = null;
    let hit = null;
    let post = null;
    if (sentence) {
      const at = sentence.toLowerCase().indexOf(term.toLowerCase());
      if (at >= 0) {
        pre = sentence.slice(0, at);
        hit = sentence.slice(at, at + term.length);
        post = sentence.slice(at + term.length);
      } else {
        pre = sentence;
      }
    }
    return [{
      term,
      pos: clean(row.pos),
      vi: clean(row.meaning_vi),
      collocation: clean(row.collocation),
      sentence: sentence ? { pre, hit, post } : null,
    }];
  });
}

/**
 * The Vocabulary entry for a term (FR-017): a result of
 * `GET /api/vocabulary/search?q=<term>` whose headword equals the term (case
 * and spacing ignored). No such entry → null, and the page shows no link.
 *
 * @param {string} term
 * @param {unknown} results
 * @returns {string | null} `/vocabulary?cat=…&slug=…`
 */
export function vocabEntryHref(term, results) {
  const want = term.trim().replace(/\s+/g, ' ').toLowerCase();
  const list = Array.isArray(results) ? results : [];
  const hit = list.find((r) => r && typeof r === 'object'
    && typeof r.headword === 'string'
    && r.headword.trim().replace(/\s+/g, ' ').toLowerCase() === want
    && typeof r.slug === 'string' && r.slug
    && typeof r.category === 'string' && r.category);
  if (!hit) return null;
  return `/vocabulary?${new URLSearchParams({ cat: hit.category, slug: hit.slug }).toString()}`;
}

/**
 * Sections of the page in order, empty ones dropped and the rest renumbered
 * (FR-016). Task 2 section 3 is "Ma trận ý", which the public API does not
 * carry yet, so it is dropped; Task 1 section 3 is "Đặc điểm chính".
 *
 * @param {{ hasPrompt: boolean, hasOutline: boolean, hasIdeas: boolean, hasFeatures: boolean, task: unknown,
 *           hasEssays: boolean, hasJudgement: boolean, hasVocab: boolean, hasRelated: boolean }} have
 * @returns {{ id: string, label: string, n: string }[]}
 */
export function pageSections(have) {
  const all = [
    { id: 'de-bai', label: 'Đề bài', on: have.hasPrompt },
    { id: 'dan-y', label: 'Dàn ý', on: have.hasOutline },
    have.task === 'task1'
      ? { id: 'dac-diem-chinh', label: 'Đặc điểm chính', on: have.hasFeatures }
      : { id: 'ma-tran-y', label: 'Ma trận ý', on: have.hasIdeas },
    { id: 'ba-bai-mau', label: 'Ba bài mẫu', on: have.hasEssays },
    { id: 'nhan-dinh', label: 'Nhận định theo bốn tiêu chí', on: have.hasJudgement },
    { id: 'tu-vung', label: 'Từ vựng đáng học', on: have.hasVocab },
    { id: 'de-lien-quan', label: 'Đề liên quan', on: have.hasRelated },
  ];
  return all.filter((s) => s.on).map((s, i) => ({ id: s.id, label: s.label, n: String(i + 1) }));
}

/**
 * Which "write this prompt" offer to show (FR-018).
 * - `guest`: not signed in, or no course → block "Tự viết đề này" at the end, secondary button;
 * - `write`: a course with AI grading left → primary "Viết đề này" beside the prompt;
 * - `buy`: a course with none left → "Đăng ký thêm lượt chấm".
 *
 * @param {{ signedIn?: boolean, hasCourse?: boolean, creditsLeft?: number | null } | null | undefined} access
 * @returns {'guest' | 'write' | 'buy'}
 */
export function writeOffer(access) {
  if (!access?.signedIn || !access.hasCourse) return 'guest';
  return typeof access.creditsLeft === 'number' && access.creditsLeft > 0 ? 'write' : 'buy';
}
