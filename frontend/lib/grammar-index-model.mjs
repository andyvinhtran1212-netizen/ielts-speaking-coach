// Grammar Wiki home index (LIBRARY-0061 T014 part b = G06-T14b; tờ GrammarWiki §1, §3, §4).
//
// Pure helpers for `/grammar`: the topic tree ("Theo nhóm"), the A–Z list (by
// Vietnamese name) and the instant search that matches without Vietnamese accents. Everything is
// built from `GET /api/grammar/groups`, so counts are never hard-coded.

/**
 * @typedef {{ slug: string, category: string, title: string, status?: string, level?: string, summary?: string }} GroupArticleWire
 * @typedef {{ slug: string, title: string, description?: string, articles?: GroupArticleWire[] }} GroupWire
 * @typedef {{ slug: string, category: string, en: string, vi: string, title: string, groupSlug: string, groupName: string, groupN: number, folded: string }} IndexEntry
 * @typedef {{ slug: string, name: string, description: string, n: number, entries: IndexEntry[] }} IndexGroup
 */

export const SEARCH_LIMIT = 12;

/** Lower-case, no accents, "đ" → "d", single spaces: "Bị động" → "bi dong". */
export function foldVi(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const VI_LETTER = /[À-ỹđĐ]/;

/**
 * "Passive Voice — Câu bị động" → { en: "Passive Voice", vi: "Câu bị động" }.
 * Older titles put the Vietnamese name in a trailing bracket: "Adjectives (Tính từ)";
 * a bracket with no Vietnamese letter ("Future Forms (will / be going to)") stays English.
 */
export function splitTitle(title) {
  const text = String(title ?? '').trim();
  const at = text.indexOf(' — ');
  if (at >= 0) {
    const left = text.slice(0, at).trim();
    const right = text.slice(at + 3).trim();
    // A few titles put the Vietnamese name first ("Lỗi dùng giới từ — Preposition Errors").
    if (VI_LETTER.test(left) && !VI_LETTER.test(right)) return { en: right, vi: left };
    return { en: left, vi: right };
  }
  const bracket = /^(.+?)\s*\(([^()]+)\)$/.exec(text);
  if (bracket && VI_LETTER.test(bracket[2])) return { en: bracket[1].trim(), vi: bracket[2].trim() };
  return { en: text, vi: '' };
}

/** An article the backend lists but has no file for yet is not linkable. */
function isLive(article) {
  return !!article && typeof article.slug === 'string' && !!article.slug && article.status !== 'planned';
}

/**
 * Groups in `_groups.yaml` order, each with its linkable articles. A group
 * with none is left out, and the shown groups are numbered 1…N, so the numbers
 * agree with the "N nhóm" count; an article listed in two groups stays in both
 * (same URL).
 * @param {GroupWire[] | null | undefined} groups
 * @returns {IndexGroup[]}
 */
export function buildIndex(groups) {
  const out = [];
  let n = 0;
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group || typeof group.slug !== 'string') continue;
    const groupN = n + 1;
    const name = String(group.title ?? group.slug);
    const entries = (Array.isArray(group.articles) ? group.articles : []).filter(isLive).map((article) => {
      const { en, vi } = splitTitle(article.title);
      return {
        slug: article.slug,
        category: article.category,
        en,
        vi,
        title: String(article.title ?? article.slug),
        groupSlug: group.slug,
        groupName: name,
        groupN,
        folded: foldVi(`${article.title} ${article.slug.replace(/-/g, ' ')} ${name}`),
      };
    });
    if (entries.length > 0) {
      n = groupN;
      out.push({ slug: group.slug, name, description: String(group.description ?? ''), n, entries });
    }
  }
  return out;
}

/** The `_groups.yaml` group behind "Lỗi hay gặp" on the home page (FR-040). */
export const COMMON_ERRORS_GROUP = 'error-clinic';

/**
 * "Lỗi hay gặp": the first articles of the Error Clinic group, in file order,
 * plus that group for the "see all" link. Null when the group has no live article.
 * @param {IndexGroup[]} index @param {number} [limit]
 * @returns {{ group: IndexGroup, entries: IndexEntry[] } | null}
 */
export function commonErrors(index, limit = 6) {
  const group = index.find((g) => g.slug === COMMON_ERRORS_GROUP);
  return group ? { group, entries: group.entries.slice(0, limit) } : null;
}

/**
 * Every linkable article once (first group wins), for counts, A–Z and search.
 * @param {IndexGroup[]} index @returns {IndexEntry[]}
 */
export function uniqueEntries(index) {
  const seen = new Set();
  const out = [];
  for (const group of index) {
    for (const entry of group.entries) {
      if (seen.has(entry.slug)) continue;
      seen.add(entry.slug);
      out.push(entry);
    }
  }
  return out;
}

/**
 * Instant search: every word of the query must appear in the folded English
 * title, Vietnamese title, slug or group name. Matches whose English title
 * starts with the query come first, then the index order.
 * @param {IndexGroup[]} index @param {string} query @param {number} [limit]
 * @returns {{ results: IndexEntry[], more: number, total: number }}
 */
export function searchIndex(index, query, limit = SEARCH_LIMIT) {
  const words = foldVi(query).split(' ').filter(Boolean);
  if (words.length === 0) return { results: [], more: 0, total: 0 };
  const phrase = words.join(' ');
  const hits = uniqueEntries(index)
    .map((entry, order) => ({ entry, order }))
    .filter(({ entry }) => words.every((w) => entry.folded.includes(w)))
    .sort((a, b) => {
      const ap = foldVi(a.entry.en).startsWith(phrase) ? 0 : 1;
      const bp = foldVi(b.entry.en).startsWith(phrase) ? 0 : 1;
      return ap - bp || a.order - b.order;
    })
    .map(({ entry }) => entry);
  return { results: hits.slice(0, limit), more: Math.max(0, hits.length - limit), total: hits.length };
}

/** The 26 letters of the A–Z bar; a letter with no article is shown dimmed. */
export const AZ_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** A–Z sorts by the Vietnamese name (FR-041); an article without one uses its English title. */
export function azName(entry) {
  return entry.vi || entry.en;
}

/**
 * A–Z sections by the first letter of the Vietnamese name, accents dropped
 * ("Đảo ngữ" → D); anything that does not start with a letter goes under "#", last.
 * @param {IndexGroup[]} index
 * @returns {{ letter: string, entries: IndexEntry[] }[]}
 */
export function azSections(index) {
  const sorted = uniqueEntries(index).sort(
    (a, b) => azName(a).localeCompare(azName(b), 'vi', { sensitivity: 'base' }) || a.slug.localeCompare(b.slug),
  );
  const byLetter = new Map();
  for (const entry of sorted) {
    const first = foldVi(azName(entry)).charAt(0).toUpperCase();
    const letter = /^[A-Z]$/.test(first) ? first : '#';
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter).push(entry);
  }
  return [...byLetter.entries()]
    .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
    .map(([letter, entries]) => ({ letter, entries }));
}

/**
 * The group a URL names (`?nhom=`), else the first one; null when there is none.
 * @param {IndexGroup[]} index @param {string} slug @returns {IndexGroup | null}
 */
export function pickGroup(index, slug) {
  return index.find((g) => g.slug === slug) ?? index[0] ?? null;
}

/** URL of the home index for a view (`?xem=az`) and group (`?nhom=`), keeping `?mode=learning` out. */
export function indexHref({ view = 'groups', group = '' } = {}) {
  const params = new URLSearchParams();
  if (view === 'az') params.set('xem', 'az');
  else if (group) params.set('nhom', group);
  const qs = params.toString();
  return `/grammar${qs ? `?${qs}` : ''}#groups-section`;
}
