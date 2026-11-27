// Kiến thức Writing pages (LIBRARY-0061 T011 = G06-T11; tờ KienThucWriting).
//
// Pure helpers shared by the list `/library/writing-guides` and one guide
// `/library/writing-guides/[slug]`, kept out of the TSX so the contract suite
// can test them without a browser.

/**
 * @typedef {{ slug: string, title: string, summary: string, reading_minutes: number, groups: string[], updated_at: string | null }} GuideItem
 * @typedef {{ id: string, label: string, items: GuideItem[] }} GuideGroup
 */

/** FR-020: the four fixed groups, in order, with the sheet's one-line notes. */
export const GUIDE_GROUPS = Object.freeze([
  Object.freeze({ id: 'task1', n: '1', label: 'Task 1', note: 'Biểu đồ, bảng, quy trình: tả và so sánh số liệu.' }),
  Object.freeze({ id: 'task2', n: '2', label: 'Task 2', note: 'Bố cục bài luận: mở bài, thân bài, kết bài.' }),
  Object.freeze({ id: 'criteria', n: '3', label: 'Tiêu chí chấm', note: 'Người chấm đọc bài theo bốn tiêu chí nào.' }),
  Object.freeze({ id: 'question-type', n: '4', label: 'Dạng đề', note: 'Sáu dạng Task 2 và điều mỗi dạng bắt buộc phải trả lời.' }),
]);

const GROUP_BY_ID = new Map(GUIDE_GROUPS.map((g) => [g.id, g]));

/** The fixed group of an id (number, label, note), or null for an unknown id. */
export function guideGroup(id) {
  return GROUP_BY_ID.get(id) ?? null;
}

/** Anchor of a group section on the list page. */
export function groupAnchor(id) {
  return `nhom-${id}`;
}

export function guideHref(slug) {
  return `/library/writing-guides/${encodeURIComponent(slug)}`;
}

/**
 * Groups to draw, in the fixed order, each with its fixed number and note.
 * A group with no guide is left out (ui-states); groups the API does not
 * know are ignored, so the page never draws a fifth group.
 * @param {GuideGroup[] | null | undefined} groups
 */
export function visibleGroups(groups) {
  const byId = new Map((Array.isArray(groups) ? groups : []).map((g) => [g?.id, g]));
  return GUIDE_GROUPS.flatMap((fixed) => {
    const items = byId.get(fixed.id)?.items;
    return Array.isArray(items) && items.length > 0 ? [{ ...fixed, items }] : [];
  });
}

/** "20/11/2026" in Vietnam time for an ISO timestamp; null when unreadable. */
export function formatGuideDate(iso) {
  if (typeof iso !== 'string' || !iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/**
 * While the sample page (T010) is not live, a citation must not link to a 404:
 * the inline link becomes plain text and the card's "Mở đề này" line is
 * dropped. The quote itself stays. Matches only the markup the backend writes
 * (`services/library_guides.py`), whose attributes are already escaped.
 * @param {string} html @param {boolean} sampleLive
 */
export function withSampleLinks(html, sampleLive) {
  const text = typeof html === 'string' ? html : '';
  if (sampleLive) return text;
  return text
    .replace(/<a class="sample-cite-link" href="[^"]*">([^<]*)<\/a>/g, '<span class="sample-cite-link">$1</span>')
    .replace(/<a class="sample-cite-open" href="[^"]*">[^<]*<\/a>/g, '');
}
