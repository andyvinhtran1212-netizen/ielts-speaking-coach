// Shelves of the public Library hub `/library` (LIBRARY-0061 T008, FR-063).
//
// The page draws its shelves from this array and never hard-codes them in JSX.
// This batch has exactly five. GOI-13 part C adds the sixth
// (`/library/background`) by appending one entry here; the page layout must not
// change for that. No entry may be an empty shelf or a "Sắp có" label.
//
// `summaryKey` names the shelf's object in `GET /api/library/summary`, and
// `count(entry)` turns that object into the text shown beside the shelf title,
// or `null` to show no number at all (FR-004: never "0", never "0/0").

/**
 * @typedef {Record<string, unknown> | null | undefined} SummaryEntry
 * @typedef {{
 *   id: string,
 *   title: string,
 *   href: string,
 *   description: string,
 *   summaryKey: string,
 *   count: (entry: SummaryEntry) => string | null,
 * }} LibraryShelf
 */

/** A positive whole number from the summary, else null (missing, 0, negative or not a number). */
export function positiveCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * `positiveCount` printed as the design sheets print counts, thousands split by
 * a no-break space ("1 284"), the same rule as `components/ui/format-count.ts`;
 * not the "1.284" of `vi-VN`, which reads as a decimal next to band scores.
 * Else null.
 */
export function formatShelfNumber(value) {
  const n = positiveCount(value);
  return n === null ? null : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

/** @type {readonly LibraryShelf[]} */
export const LIBRARY_SHELVES = Object.freeze([
  Object.freeze({
    id: 'bai-mau-writing',
    title: 'Bài mẫu Writing',
    href: '/library/writing-samples',
    description:
      'Cùng một đề, cùng ý, viết ở ba mức điểm. Chuyển qua lại để thấy đúng chỗ nào làm bài tụt band.',
    summaryKey: 'writing_samples',
    count(entry) {
      const total = formatShelfNumber(entry?.total);
      return total ? `${total} đề · mỗi đề ba bản 7.5, 7.0 và 6.0` : null;
    },
  }),
  Object.freeze({
    id: 'kien-thuc-writing',
    title: 'Kiến thức Writing',
    href: '/library/writing-guides',
    description:
      'Cách viết Task 1 và Task 2, cách người chấm đọc bài theo bốn tiêu chí, và cách làm từng dạng đề.',
    summaryKey: 'writing_guides',
    count(entry) {
      const total = formatShelfNumber(entry?.total);
      return total ? `${total} bài` : null;
    },
  }),
  Object.freeze({
    id: 'de-speaking',
    title: 'Đề Speaking và video trả lời mẫu',
    href: '/library/speaking',
    description: 'Đề Part 1, 2, 3 kèm câu trả lời mẫu có lời thoại, từ vựng và cấu trúc đáng học.',
    summaryKey: 'speaking',
    count(entry) {
      // Counted, and nothing on the shelf yet: say so in words (ui-states).
      if (entry && entry.total === 0) return 'Chưa có đề nào';
      const total = formatShelfNumber(entry?.total);
      if (!total) return null;
      const video = formatShelfNumber(entry?.with_video);
      return video ? `${total} đề · ${video} đề có video` : `${total} đề`;
    },
  }),
  Object.freeze({
    id: 'ngu-phap',
    title: 'Ngữ pháp',
    href: '/grammar',
    description: 'Bài ngữ pháp giải thích bằng tiếng Việt, ví dụ tiếng Anh, dùng cho cả nói và viết.',
    summaryKey: 'grammar',
    count(entry) {
      const total = formatShelfNumber(entry?.total);
      return total ? `${total} bài` : null;
    },
  }),
  Object.freeze({
    id: 'tu-vung',
    title: 'Từ vựng',
    href: '/vocabulary',
    description: 'Mục từ có nghĩa, phát âm, ví dụ và cách dùng trong bài thi.',
    summaryKey: 'vocabulary',
    count(entry) {
      const total = formatShelfNumber(entry?.total);
      return total ? `${total} mục từ` : null;
    },
  }),
]);

/**
 * The text beside each shelf title for a summary payload (or `null` when the
 * summary failed): one entry per shelf, `null` meaning "show no number".
 *
 * @param {readonly LibraryShelf[]} shelves
 * @param {Record<string, SummaryEntry> | null | undefined} summary
 * @returns {Array<{ shelf: LibraryShelf, countText: string | null }>}
 */
export function shelvesWithCounts(shelves, summary) {
  return shelves.map((shelf) => {
    const entry = summary && typeof summary === 'object' ? summary[shelf.summaryKey] : null;
    return { shelf, countText: entry && typeof entry === 'object' ? shelf.count(entry) : null };
  });
}
