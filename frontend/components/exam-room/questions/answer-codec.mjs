// @ts-check
// EXAMROOM-0066 FR-025, FR-027: the answer strings the shared question types
// hand back. Each function copies what one surface sends as `user_answer`
// today, so the server receives exactly the same string after the switch.
// Reading and Listening are NOT normalised to one rule: an option's value, the
// order of a multi-choice selection and the gap marker syntax differ between
// them and stay different.
//
// Sources (staging @ cc6dd4c8):
// - Reading: app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx
//   optionValue/optionPrefix/optionBodyText, QuestionControl (TFNG, mcq_multi
//   comma list), GroupedMcqRun (slots in option order).
// - Listening: app/(authed-listening-player)/listening/test/session/listening-test-session.tsx
//   optionValue/optionText, MultiSelectTemplate (slots in click order),
//   SummaryTemplate ({{Qn}} markers).

import { splitNumberedBlanks } from '../../../lib/numbered-blank.mjs';

/**
 * @typedef {{ value: string, prefix: string, text: string }} ExamRoomOption
 * @typedef {string | { q: number }} ExamRoomSegment
 * @typedef {'csv' | 'slots-option-order' | 'slots-click-order'} MultiChoiceEncoding
 */

/**
 * A Reading option as the Reading player reads it: value is `label`, falling
 * back to `text`; a bare string is its own value.
 * @param {unknown} option
 * @returns {ExamRoomOption}
 */
export function readingOption(option) {
  if (typeof option === 'string') return { value: option, prefix: '', text: option };
  const o = /** @type {any} */ (option) ?? {};
  return {
    value: String(o.label ?? o.text ?? ''),
    prefix: String(o.label ?? ''),
    text: String(o.text ?? o.label ?? ''),
  };
}

/**
 * A Listening option as the Listening player reads it: value is `letter`, then
 * `label`, then `value`; the letter is always printed before the text.
 * @param {unknown} option
 * @returns {ExamRoomOption}
 */
export function listeningOption(option) {
  if (typeof option === 'string') return { value: option, prefix: option, text: option };
  const o = /** @type {any} */ (option) ?? {};
  const value = String(o.letter ?? o.label ?? o.value ?? '');
  return { value, prefix: value, text: String(o.text ?? o.label ?? o.letter ?? '') };
}

/** TRUE/FALSE/NOT GIVEN and YES/NO/NOT GIVEN, exactly as Reading sends them. */
export const CLAIM_VALUES = Object.freeze({
  tfng: Object.freeze(['TRUE', 'FALSE', 'NOT GIVEN']),
  ynng: Object.freeze(['YES', 'NO', 'NOT GIVEN']),
});

/**
 * Selected values of a multi-choice, read from the stored answers.
 * - `csv`: one question, values joined by "," (Reading `mcq_multi`).
 * - `slots-*`: one value per question number (Reading grouped MCQ, Listening
 *   `mcq_multi`), empty slots skipped.
 * @param {MultiChoiceEncoding} encoding
 * @param {string[]} slotValues the stored answer of each question, in q order
 * @returns {string[]}
 */
export function multiChoiceSelection(encoding, slotValues) {
  if (encoding === 'csv') return String(slotValues[0] ?? '').split(',').filter(Boolean);
  return slotValues.filter(Boolean);
}

/**
 * New stored answers after ticking or unticking `value`.
 * - `csv` (Reading `mcq_multi`): selection kept in click order, joined by ",".
 * - `slots-option-order` (Reading grouped MCQ): selection sorted by the option
 *   list, cut to `choose`, one per slot, missing slots "".
 * - `slots-click-order` (Listening `mcq_multi`): selection in click order, one
 *   per slot, missing slots "".
 * @param {{ encoding: MultiChoiceEncoding, slotValues: string[], value: string, checked: boolean, optionValues: string[], choose: number }} input
 * @returns {string[]} one string per slot (a single string for `csv`)
 */
export function toggleMultiChoice({ encoding, slotValues, value, checked, optionValues, choose }) {
  if (encoding === 'csv') {
    const next = new Set(multiChoiceSelection('csv', slotValues));
    if (checked) next.add(value); else next.delete(value);
    return [[...next].join(',')];
  }
  if (encoding === 'slots-option-order') {
    const next = new Set(slotValues.filter(Boolean));
    if (checked) next.add(value); else next.delete(value);
    const ordered = optionValues.filter((option) => next.has(option)).slice(0, choose);
    return slotValues.map((_, index) => ordered[index] || '');
  }
  const selected = slotValues.filter(Boolean);
  const next = checked ? [...selected, value] : selected.filter((item) => item !== value);
  return slotValues.map((_, index) => next[index] || '');
}

/**
 * Whether an unticked option is locked because enough are chosen. `choose` 0
 * means no limit (Reading `mcq_multi` without `template.choose`).
 * @param {{ selected: string[], value: string, choose: number }} input
 */
export function multiChoiceLocked({ selected, value, choose }) {
  return !selected.includes(value) && choose > 0 && selected.length >= choose;
}

/**
 * Which questions of a matching group already use each option (FR-025: a used
 * option is struck through in the bank, with "(used in Q6)").
 * @param {{ q: number }[]} questions
 * @param {Record<number, string> | Map<number, string>} answers
 * @returns {Map<string, number[]>}
 */
export function optionUsage(questions, answers) {
  const get = (/** @type {number} */ q) => (answers instanceof Map ? answers.get(q) : answers[q]) || '';
  /** @type {Map<string, number[]>} */
  const usage = new Map();
  for (const { q } of [...questions].sort((a, b) => a.q - b.q)) {
    const value = get(q);
    if (!value) continue;
    usage.set(value, [...(usage.get(value) ?? []), q]);
  }
  return usage;
}

/**
 * Template text to segments.
 * - `reading`: `{{21}}` markers, a trailing `____` run is the same blank (RV-05).
 * - `listening`: `{{Q21}}` markers (Listening `summary_completion`).
 * @param {string} text
 * @param {'reading' | 'listening'} syntax
 * @returns {ExamRoomSegment[]}
 */
export function templateSegments(text, syntax) {
  const source = String(text ?? '');
  if (syntax === 'reading') {
    return splitNumberedBlanks(source).map((part) => (typeof part === 'string' ? part : { q: part.qNum }));
  }
  return source.split(/(\{\{Q\d+\}\})/).filter((piece) => piece !== '').map((piece) => {
    const match = /^\{\{Q(\d+)\}\}$/.exec(piece);
    return match ? { q: Number(match[1]) } : piece;
  });
}

/**
 * A prompt with one inline gap (`__` or longer), split around it; null when the
 * prompt has none (Reading `InlineGap`).
 * @param {string} prompt
 * @returns {{ before: string, after: string } | null}
 */
export function inlineGap(prompt) {
  const source = String(prompt ?? '');
  const match = /_{2,}/.exec(source);
  if (!match) return null;
  return { before: source.slice(0, match.index), after: source.slice(match.index + match[0].length) };
}

/**
 * "9 of 13 correct" after grading (FR-026); null when there is nothing to
 * count, so "0/0" is never shown.
 * @param {{ correct: number, total: number }} score
 * @param {{ score: (correct: number, total: number) => string }} strings
 * @returns {string | null}
 */
export function scoreText({ correct, total }, strings) {
  if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(correct) || correct < 0 || correct > total) return null;
  return strings.score(correct, total);
}
