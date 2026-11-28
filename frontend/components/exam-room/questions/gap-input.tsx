'use client';

// EXAMROOM-0066 FR-025: the one text gap every completion type uses. The value
// goes back exactly as typed (no trim), like both players today. A native
// input, because G03 TextField always prints a visible label and these gaps sit
// inside a sentence or a table cell; the label is the question number.
import { Fragment, type ReactNode } from 'react';

import type { ExamRoomSegment } from './answer-codec.mjs';
import styles from './questions.module.css';
import type { AnswerProps } from './types';

export function GapInput({ q, answers, onAnswer, readOnly, strings }: AnswerProps & { q: number }) {
  return (
    <input
      className={styles.gap}
      type="text"
      autoComplete="off"
      spellCheck={false}
      name={`q-${q}`}
      data-q={q}
      aria-label={strings.answerLabel(q)}
      value={answers[q] ?? ''}
      disabled={readOnly}
      onChange={(event) => onAnswer(q, event.target.value)}
    />
  );
}

/** A numbered gap: the small number, then the input. */
export function NumberedGap(props: AnswerProps & { q: number; renderGap?: (q: number) => ReactNode }) {
  const { q, renderGap } = props;
  return (
    <span className={styles.numberedGap} id={`q-${q}`} data-q={q}>
      <span className={styles.qNum} aria-hidden="true">{q}</span>
      {renderGap ? renderGap(q) : <GapInput {...props} />}
    </span>
  );
}

/** Text and gaps in authored order. */
export function Segments({ segments, renderGap, ...props }: AnswerProps & { segments: readonly ExamRoomSegment[]; renderGap?: (q: number) => ReactNode }) {
  return <>{segments.map((segment, index) => (
    <Fragment key={index}>
      {typeof segment === 'string' ? segment : <NumberedGap {...props} q={segment.q} renderGap={renderGap} />}
    </Fragment>
  ))}</>;
}
