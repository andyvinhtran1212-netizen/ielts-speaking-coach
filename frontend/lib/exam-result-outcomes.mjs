const answeredText = (row) => String(row?.user_answer ?? '').trim();

/**
 * Presentation only (MOCKREPAIR-0016 FR-013): split the submitted per-question
 * rows into incorrect and unanswered. The persisted `correct` flag stays the
 * grade; a blank row is never counted as an incorrect answer (RV-06). Same
 * precedence as the review pages: correct, then blank, then incorrect.
 */
export function examResultOutcomes(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let incorrect = 0; let unanswered = 0;
  for (const row of list) {
    if (row?.correct) continue;
    if (answeredText(row)) incorrect += 1;
    else unanswered += 1;
  }
  return { incorrect, unanswered };
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** Next-step heading, or `fallback` when nothing needs review. */
export function examResultNextStepTitle({ incorrect, unanswered }, fallback) {
  if (incorrect && unanswered) return `Review ${plural(incorrect, 'incorrect answer', 'incorrect answers')} and ${plural(unanswered, 'unanswered question', 'unanswered questions')}`;
  if (incorrect) return `Review ${plural(incorrect, 'incorrect answer', 'incorrect answers')}`;
  if (unanswered) return `Review ${plural(unanswered, 'unanswered question', 'unanswered questions')}`;
  return fallback;
}
