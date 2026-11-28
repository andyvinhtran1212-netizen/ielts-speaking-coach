// EXAMROOM-0066 FR-025, FR-027: props shared by the question types. Answers are
// the surface's own strings, keyed by question number; a type never trims or
// normalises them (see answer-codec.mjs).
import type { QUESTION_STRINGS_EN } from './question-strings.mjs';

export type QuestionStrings = typeof QUESTION_STRINGS_EN;
export type { ExamRoomOption, ExamRoomSegment, MultiChoiceEncoding } from './answer-codec.mjs';

export type AnswerProps = {
  answers: Readonly<Record<number, string>>;
  onAnswer(q: number, value: string): void;
  /** Read-only tab (0066 FR-017): controls shown but disabled. */
  readOnly?: boolean;
  strings: QuestionStrings;
};

export type PromptedQuestion = { q: number; prompt: string };
