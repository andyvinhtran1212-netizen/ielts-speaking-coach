// LIBRARY-0061 T013 (FR-033, FR-034): timed transcript helpers of the Speaking
// shelf. Pure functions, shared by the page (server) and the player (client).

/**
 * Index of the line being spoken: the line with the largest start time that is
 * not after `ms` (FR-033). Before the first start, or with no timed lines: -1.
 * `starts` must be strictly increasing (the API serves untimed lines otherwise).
 * @param {readonly (number | null)[]} starts
 * @param {number} ms
 * @returns {number}
 */
export function activeCueIndex(starts, ms) {
  if (!Number.isFinite(ms) || starts.length === 0 || starts.some((s) => typeof s !== 'number')) return -1;
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (/** @type {number} */ (starts[mid]) <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * "m:ss" (or "h:mm:ss") for a time in milliseconds; null for a missing time.
 * @param {number | null | undefined} ms
 * @returns {string | null}
 */
export function formatClock(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Splits one transcript line into plain runs and marked phrases, numbering the
 * marks from `firstNumber` in reading order (FR-034: numbers restart at 1 on
 * every page, so the caller passes the running count). Overlapping or
 * out-of-range marks are dropped instead of breaking the text.
 * @param {string} text
 * @param {readonly { kind: string, start: number, end: number, note?: string | null }[]} marks
 * @param {number} firstNumber
 * @returns {{ parts: ({ text: string } | { text: string, kind: string, n: number, note: string | null })[], next: number }}
 */
export function markSegments(text, marks, firstNumber = 1) {
  const sorted = [...(marks ?? [])]
    .filter((m) => Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.start < m.end && m.end <= text.length)
    .sort((a, b) => a.start - b.start);
  /** @type {({ text: string } | { text: string, kind: string, n: number, note: string | null })[]} */
  const parts = [];
  let at = 0;
  let n = firstNumber;
  for (const mark of sorted) {
    if (mark.start < at) continue;
    if (mark.start > at) parts.push({ text: text.slice(at, mark.start) });
    parts.push({ text: text.slice(mark.start, mark.end), kind: mark.kind, n, note: mark.note ?? null });
    n += 1;
    at = mark.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return { parts, next: n };
}

/** Vietnamese label of a mark kind, always printed next to its number (FR-034). */
export const MARK_LABELS = Object.freeze({ vocab: 'Từ vựng đáng học', structure: 'Cấu trúc đáng học' });

/**
 * The answer status in words (FR-031), e.g. "Có video trả lời mẫu · 1:42" or
 * "Chưa có video · câu trả lời mẫu dạng chữ".
 * @param {{ answer_kind: string, duration_s?: number | null }} item
 * @returns {string}
 */
export function answerStatus(item) {
  if (item.answer_kind === 'video') {
    const clock = typeof item.duration_s === 'number' ? formatClock(item.duration_s * 1000) : null;
    return clock ? `Có video trả lời mẫu · ${clock}` : 'Có video trả lời mẫu';
  }
  return item.answer_kind === 'audio'
    ? 'Chưa có video · câu trả lời mẫu dạng audio'
    : 'Chưa có video · câu trả lời mẫu dạng chữ';
}
