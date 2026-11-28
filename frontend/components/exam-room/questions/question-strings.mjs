// @ts-check
// EXAMROOM-0066 FR-002, FR-025, FR-026: copy of the shared question types.
// English in `test` mode, Vietnamese ("bạn") in `practice` mode; same keys.
// Option values (TRUE/FALSE/NOT GIVEN, letters) are never translated: they
// are the answer strings the server stores.

export const QUESTION_STRINGS_EN = Object.freeze({
  lang: 'en',
  /** @param {number} q */
  answerLabel: (q) => `Answer ${q}`,
  /** @param {number} q */
  questionLabel: (q) => `Question ${q}`,
  /** @param {number} first @param {number} last */
  questionRange: (first, last) => (first === last ? `Question ${first}` : `Questions ${first}–${last}`),
  /** @param {number} n */
  chooseCount: (n) => `Choose ${n} answers.`,
  /** @param {number} n @param {number} total */
  selectedCount: (n, total) => `Selected ${n} of ${total}`,
  /** @param {number} n */
  selectedAny: (n) => `Selected ${n}`,
  /** @param {number[]} qs */
  usedIn: (qs) => `(used in ${qs.map((q) => `Q${q}`).join(', ')})`,
  selectPlaceholder: '— Select —',
  /** @param {string} limit */
  wordLimit: (limit) => `Write ${limit}.`,
  options: 'Options',
  statement: 'Statement',
  correct: 'Correct',
  incorrect: 'Incorrect',
  unanswered: 'Not answered',
  yourAnswer: 'Your answer',
  correctAnswer: 'Correct answer',
  /** @param {number} correct @param {number} total */
  score: (correct, total) => `${correct} of ${total} correct`,
});

export const QUESTION_STRINGS_VI = Object.freeze({
  lang: 'vi',
  /** @param {number} q */
  answerLabel: (q) => `Đáp án câu ${q}`,
  /** @param {number} q */
  questionLabel: (q) => `Câu ${q}`,
  /** @param {number} first @param {number} last */
  questionRange: (first, last) => (first === last ? `Câu ${first}` : `Câu ${first}–${last}`),
  /** @param {number} n */
  chooseCount: (n) => `Chọn ${n} đáp án.`,
  /** @param {number} n @param {number} total */
  selectedCount: (n, total) => `Đã chọn ${n} trên ${total}`,
  /** @param {number} n */
  selectedAny: (n) => `Đã chọn ${n}`,
  /** @param {number[]} qs */
  usedIn: (qs) => `(đã dùng ở câu ${qs.join(', ')})`,
  selectPlaceholder: '— Chọn —',
  /** @param {string} limit */
  wordLimit: (limit) => `Viết ${limit}.`,
  options: 'Lựa chọn',
  statement: 'Câu',
  correct: 'Đúng',
  incorrect: 'Sai',
  unanswered: 'Chưa trả lời',
  yourAnswer: 'Bạn trả lời',
  correctAnswer: 'Đáp án đúng',
  /** @param {number} correct @param {number} total */
  score: (correct, total) => `Đúng ${correct} trên ${total} câu`,
});

/** @param {'test' | 'practice'} mode */
export function questionStrings(mode) {
  return mode === 'practice' ? QUESTION_STRINGS_VI : QUESTION_STRINGS_EN;
}
