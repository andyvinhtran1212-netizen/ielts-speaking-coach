'use client';

// EXAMROOM-0066 FR-027: summary completion. Prose with numbered gaps; with a
// word bank each gap is a select of the bank's values (Reading
// `summary_completion` with options), otherwise a text gap.
import { optionUsage, type ExamRoomOption, type ExamRoomSegment } from './answer-codec.mjs';
import { Segments } from './gap-input';
import { OptionBank } from './matching';
import styles from './questions.module.css';
import type { AnswerProps } from './types';

export function SummaryCompletion({ segments, bank, bankTitle, ...props }: AnswerProps & {
  segments: readonly ExamRoomSegment[];
  bank?: readonly ExamRoomOption[];
  bankTitle?: string;
}) {
  const { answers, onAnswer, readOnly, strings } = props;
  const gaps = segments.flatMap((segment) => (typeof segment === 'string' ? [] : [{ q: segment.q }]));
  const withBank = Boolean(bank && bank.length);
  const renderGap = withBank ? (q: number) => (
    <select
      className={styles.inlineSelect}
      name={`q-${q}`}
      data-q={q}
      aria-label={strings.answerLabel(q)}
      value={answers[q] ?? ''}
      disabled={readOnly}
      onChange={(event) => onAnswer(q, event.target.value)}
    >
      <option value="">{strings.selectPlaceholder}</option>
      {(bank ?? []).map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}
    </select>
  ) : undefined;
  return (
    <div className={styles.group} data-question-kind="summary">
      {withBank ? <OptionBank title={bankTitle ?? strings.options} options={bank ?? []} usage={optionUsage(gaps, answers)} strings={strings} /> : null}
      <p className={styles.prose}><Segments {...props} segments={segments} renderGap={renderGap} /></p>
    </div>
  );
}
