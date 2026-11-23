// LEARNERCORE-0063 amendment 4 (G07-T31): the review pages' new tree.
//
// Pure helpers shared by /listening/review and /reading/review:
//   - FR-105 "Chỉ câu sai": the `?only=wrong` URL state.
//   - FR-106/FR-107 review notes: wire shape, the 500-character rule counted
//     as the learner sees it (code points, like the server's len()), the
//     error text shown at the box.
//   - FR-109 my_flagged_q_nums: a missing or malformed field is "none".

export const NOTE_MAX_CHARS = 500;

/** Characters as shown (code points), so "ạ" or an emoji counts once. */
export function noteLength(text) {
  return [...String(text ?? '')].length;
}

/** The trimmed note is what the server stores; this is what the counter shows. */
export function noteTooLong(text) {
  return noteLength(String(text ?? '').trim()) > NOTE_MAX_CHARS;
}

function positiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

/** FR-109: the questions the caller already flagged; anything else → []. */
export function flaggedQNums(payload) {
  const raw = payload && typeof payload === 'object' ? payload.my_flagged_q_nums : null;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(positiveInt))].sort((a, b) => a - b);
}

/** GET /api/review-notes → Map(q_num → {body, updatedAt}); a bad shape throws. */
export function normalizeReviewNotes(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.notes)) {
    throw new Error('invalid-review-notes');
  }
  const notes = new Map();
  for (const row of payload.notes) {
    if (!row || !positiveInt(row.q_num) || typeof row.body !== 'string') {
      throw new Error('invalid-review-notes');
    }
    notes.set(row.q_num, { body: row.body, updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null });
  }
  return notes;
}

/** PATCH /api/review-notes → the stored state (body null after a delete). */
export function normalizeSavedNote(payload, qNum) {
  if (!payload || typeof payload !== 'object' || payload.q_num !== qNum) {
    throw new Error('invalid-review-note');
  }
  if (payload.body === null) return { body: null, updatedAt: null };
  if (typeof payload.body !== 'string') throw new Error('invalid-review-note');
  return { body: payload.body, updatedAt: typeof payload.updated_at === 'string' ? payload.updated_at : null };
}

/** The message under the box when a save fails; the typed text stays. */
export function noteSaveError(error) {
  const status = error && typeof error === 'object' ? error.status : null;
  const detail = error && typeof error === 'object' ? error.detail : null;
  if (status === 422 && detail && typeof detail === 'object' && typeof detail.message === 'string') {
    return detail.message;
  }
  if (status === 401) return 'Phiên đăng nhập đã hết. Đăng nhập lại để lưu ghi chú.';
  return 'Chưa lưu được ghi chú. Thử lại sau.';
}

/** FR-105: `?only=wrong` turns the filter on at load. */
export function onlyWrongFromSearch(search) {
  try {
    return new URLSearchParams(String(search ?? '')).get('only') === 'wrong';
  } catch {
    return false;
  }
}

/** The same URL with `only=wrong` set or removed; other params and the hash stay. */
export function withOnlyWrong(href, on) {
  const url = new URL(String(href), 'https://local.invalid');
  if (on) url.searchParams.set('only', 'wrong');
  else url.searchParams.delete('only');
  return `${url.pathname}${url.search}${url.hash}`;
}
