'use client';

// EXAMROOM-0066 FR-025: TRUE/FALSE/NOT GIVEN and YES/NO/NOT GIVEN. The values
// are the exact strings Reading stores today and are never translated.
import { ChoiceGroup } from '@/components/ui';

import { CLAIM_VALUES } from './answer-codec.mjs';
import styles from './questions.module.css';
import type { AnswerProps } from './types';

export function ClaimChoice({ q, prompt, kind, answers, onAnswer, readOnly, strings }: AnswerProps & {
  q: number; prompt: string; kind: 'tfng' | 'ynng';
}) {
  return (
    <div className={styles.question} id={`q-${q}`} data-q={q} data-question-kind={kind}>
      <ChoiceGroup
        mode="single"
        name={`q-${q}`}
        legend={`${strings.questionLabel(q)}. ${prompt}`}
        options={CLAIM_VALUES[kind].map((value) => ({ value, label: value, disabled: readOnly }))}
        value={answers[q] ?? ''}
        onChange={(value) => onAnswer(q, value)}
      />
    </div>
  );
}
