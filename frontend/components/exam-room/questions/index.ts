// Public exports of the shared exam-room question types (EXAMROOM-0066 T003).
export {
  CLAIM_VALUES, inlineGap, listeningOption, multiChoiceLocked, multiChoiceSelection, optionUsage,
  readingOption, scoreText, templateSegments, toggleMultiChoice,
} from './answer-codec.mjs';
export { QUESTION_STRINGS_EN, QUESTION_STRINGS_VI, questionStrings } from './question-strings.mjs';
export { ClaimChoice } from './claim-choice';
export { CompletionGrid, type CompletionLine } from './completion-grid';
export { FeatureMatrix } from './feature-matrix';
export { GapFill } from './gap-fill';
export { GapInput, NumberedGap, Segments } from './gap-input';
export { MapLabel } from './map-label';
export { Matching, OptionBank } from './matching';
export { MultiChoice } from './multi-choice';
export { QuestionResult, ScoreLine, type GradedQuestion } from './question-result';
export { ShortAnswer } from './short-answer';
export { SingleChoice, optionLabel } from './single-choice';
export { SummaryCompletion } from './summary-completion';
export type { AnswerProps, PromptedQuestion, QuestionStrings, ExamRoomOption, ExamRoomSegment, MultiChoiceEncoding } from './types';
