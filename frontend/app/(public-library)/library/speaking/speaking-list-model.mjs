// LIBRARY-0061 T013 (FR-030): URL filters and grouping of `/library/speaking`.
// Pure, shared by the server page and the client filter bar.

export const PARTS = Object.freeze(['1', '2', '3']);
export const Q_MAX = 100;
export const OTHER_TOPIC = 'Chủ đề khác';

/**
 * @param {Record<string, string | string[] | undefined>} params
 * @returns {{ part: string | null, chude: string | null, video: boolean, q: string }}
 */
export function readFilters(params) {
  const one = (key) => {
    const raw = params?.[key];
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  };
  const part = one('part');
  const chude = one('chude').trim();
  return {
    part: PARTS.includes(part) ? part : null,
    chude: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(chude) ? chude : null,
    video: one('video') === '1',
    q: one('q').trim().slice(0, Q_MAX),
  };
}

/**
 * Query string of a filter set, in a fixed order; empty filters are left out.
 * @param {{ part?: string | null, chude?: string | null, video?: boolean, q?: string }} f
 */
export function filterQuery(f) {
  const out = new URLSearchParams();
  if (f.part) out.set('part', f.part);
  if (f.chude) out.set('chude', f.chude);
  if (f.video) out.set('video', '1');
  if (f.q) out.set('q', f.q);
  const text = out.toString();
  return text ? `?${text}` : '';
}

/** API query for the same filters (`video=true`). */
export function apiQuery(f) {
  const out = new URLSearchParams();
  if (f.part) out.set('part', f.part);
  if (f.chude) out.set('chude', f.chude);
  if (f.video) out.set('video', 'true');
  if (f.q) out.set('q', f.q);
  const text = out.toString();
  return text ? `?${text}` : '';
}

/**
 * Groups items (already in shelf order) under their topic, in the topic order
 * of the shelf, with "Chủ đề khác" last. Groups left empty are not returned,
 * so an emptied group hides its heading too.
 * @template {{ topic_slug: string | null }} T
 * @param {readonly T[]} items
 * @param {readonly { slug: string, label_vi: string | null }[]} topics
 * @returns {{ slug: string | null, label: string, items: T[] }[]}
 */
export function groupByTopic(items, topics) {
  const known = new Map(topics.map((t) => [t.slug, t]));
  const groups = new Map();
  for (const item of items) {
    const key = item.topic_slug && known.has(item.topic_slug) ? item.topic_slug : null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const ordered = topics
    .filter((t) => groups.has(t.slug))
    .map((t) => ({ slug: t.slug, label: t.label_vi || t.slug, items: groups.get(t.slug) }));
  if (groups.has(null)) ordered.push({ slug: null, label: OTHER_TOPIC, items: groups.get(null) });
  return ordered;
}

/** Words for the active filters, e.g. `Part 3 · có video · "zoo"`. */
export function describeFilters(f, topicLabel) {
  return [
    f.part ? `Part ${f.part}` : null,
    f.chude ? `chủ đề ${topicLabel || f.chude}` : null,
    f.video ? 'chỉ đề có video' : null,
    f.q ? `có chữ “${f.q}”` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * "Bỏ …" lines of an empty result (tờ DeSpeakingDanhSach, trạng thái không có
 * kết quả): one per active condition whose removal shows at least one
 * question, each a link that drops exactly that condition. `relaxed` holds the
 * API's real counts; a condition without a count gets no line.
 * @param {{ part: string | null, chude: string | null, video: boolean, q: string }} f
 * @param {Partial<Record<'part' | 'chude' | 'video' | 'q', number>> | null | undefined} relaxed
 * @param {string | null} topicLabel
 * @returns {{ key: string, label: string, count: number, query: string }[]}
 */
export function relaxSuggestions(f, relaxed, topicLabel) {
  const counts = relaxed ?? {};
  const rest = (key) => ({ ...f, [key]: key === 'video' ? false : key === 'q' ? '' : null });
  const lines = [];
  const add = (key, label) => {
    const count = counts[key];
    if (typeof count === 'number' && count > 0) lines.push({ key, label, count, query: filterQuery(rest(key)) });
  };
  if (f.video) add('video', 'Bỏ “Chỉ đề có video”');
  if (f.part) add('part', f.q ? `Tìm “${f.q}” ở cả ba Part` : 'Xem cả ba Part');
  if (f.chude) add('chude', `Bỏ chủ đề “${topicLabel || f.chude}”`);
  if (f.q) {
    const kept = describeFilters(rest('q'), topicLabel);
    add('q', kept ? `Xoá chữ “${f.q}”, giữ ${kept}` : `Xoá chữ “${f.q}”`);
  }
  return lines;
}
