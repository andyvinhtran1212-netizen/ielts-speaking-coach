'use client';

// EXAMROOM-0066 FR-025: one answer from a list. The stored answer is the
// option's `value` from the surface's adapter (readingOption/listeningOption).
import { ChoiceGroup } from '@/components/ui';

import type { ExamRoomOption } from './answer-codec.mjs';
import styles from './questions.module.css';
import type { AnswerProps } from './types';

export function optionLabel(option: ExamRoomOption) {
  return option.prefix && option.prefix !== option.text ? `${option.prefix}  ${option.text}` : option.text;
}

export function SingleChoice({ q, prompt, options, answers, onAnswer, readOnly, strings }: AnswerProps & {
  q: number; prompt: string; options: readonly ExamRoomOption[];
}) {
  return (
    <div className={styles.question} id={`q-${q}`} data-q={q} data-question-kind="single">
      <ChoiceGroup
        mode="single"
        name={`q-${q}`}
        legend={`${strings.questionLabel(q)}. ${prompt}`}
        options={options.map((option) => ({ value: option.value, label: optionLabel(option), disabled: readOnly }))}
        value={answers[q] ?? ''}
        onChange={(value) => onAnswer(q, value)}
      />
    </div>
  );
}
