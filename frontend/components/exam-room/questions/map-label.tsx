'use client';

// EXAMROOM-0066 FR-027: Listening map/plan labelling. The picture with the
// choices next to it: one select of letters per question. The stored answer is
// the letter, as Listening `SelectTemplate` sends it.
import { Select } from '@/components/ui';

import styles from './questions.module.css';
import type { AnswerProps, PromptedQuestion } from './types';

export function MapLabel({ image, letters, questions, answers, onAnswer, readOnly, strings, unavailable }: AnswerProps & {
  image: { src: string; alt: string } | null;
  letters: readonly string[];
  questions: readonly PromptedQuestion[];
  /** Shown instead of the picture when it cannot be loaded. */
  unavailable: string;
}) {
  return (
    <div className={styles.mapLayout} data-question-kind="map">
      <figure className={styles.mapFigure}>
        {image?.src ? <img src={image.src} alt={image.alt} /> : <p className={styles.hint}>{unavailable}</p>}
      </figure>
      <div className={styles.rows}>{questions.map(({ q, prompt }) => (
        <div className={styles.row} id={`q-${q}`} data-q={q} key={q}>
          <span className={styles.qNum} aria-hidden="true">{q}</span>
          <Select
            label={`${strings.questionLabel(q)}. ${prompt}`}
            name={`q-${q}`}
            value={answers[q] ?? ''}
            disabled={readOnly}
            options={[{ value: '', label: strings.selectPlaceholder }, ...letters.map((letter) => ({ value: letter, label: letter }))]}
            onChange={(value) => onAnswer(q, value)}
          />
        </div>
      ))}</div>
    </div>
  );
}
