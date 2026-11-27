'use client';

// EXAMROOM-0066 FR-025: several answers from a list. Always says how many to
// choose and how many are chosen ("Selected 1 of 2"). How the selection is
// stored is the surface's `encoding` (answer-codec.mjs), never one shared rule:
// Reading `mcq_multi` keeps a click-ordered comma list on one question, the
// Reading grouped MCQ fills one slot per question in option order, Listening
// `mcq_multi` fills slots in click order.
import { ChoiceGroup } from '@/components/ui';

import { multiChoiceLocked, multiChoiceSelection, toggleMultiChoice, type ExamRoomOption, type MultiChoiceEncoding } from './answer-codec.mjs';
import styles from './questions.module.css';
import { optionLabel } from './single-choice';
import type { AnswerProps } from './types';

export function MultiChoice({ qs, prompt, options, encoding, choose, answers, onAnswer, readOnly, strings }: AnswerProps & {
  /** Question numbers of the group; exactly one for `csv`. */
  qs: readonly number[];
  prompt: string;
  options: readonly ExamRoomOption[];
  encoding: MultiChoiceEncoding;
  /** How many to choose; 0 = no limit (Reading `mcq_multi` without `template.choose`). */
  choose: number;
}) {
  const slots = encoding === 'csv' ? qs.slice(0, 1) : [...qs];
  const slotValues = slots.map((q) => answers[q] ?? '');
  const selected = multiChoiceSelection(encoding, slotValues);
  const optionValues = options.map((option) => option.value);
  const first = slots[0];
  const last = qs[qs.length - 1] ?? first;
  const count = choose > 0 ? strings.selectedCount(selected.length, choose) : strings.selectedAny(selected.length);

  function handleChange(next: string[]) {
    const added = next.find((value) => !selected.includes(value));
    const removed = selected.find((value) => !next.includes(value));
    const value = added ?? removed;
    if (value == null) return;
    const updated = toggleMultiChoice({ encoding, slotValues, value, checked: added != null, optionValues, choose });
    slots.forEach((q, index) => onAnswer(q, updated[index] ?? ''));
  }

  return (
    <div className={styles.question} id={`q-${first}`} data-q={first} data-q-group={qs.join(' ')} data-question-kind="multi">
      {qs.slice(1).map((q) => <span key={q} id={`q-${q}`} data-q={q} aria-hidden="true" />)}
      <ChoiceGroup
        mode="multiple"
        name={`q-${first}`}
        legend={`${strings.questionRange(first, last)}. ${prompt}`}
        hint={choose > 0 ? `${strings.chooseCount(choose)} ${count}` : count}
        options={options.map((option) => ({
          value: option.value,
          label: optionLabel(option),
          disabled: readOnly || multiChoiceLocked({ selected, value: option.value, choose }),
        }))}
        value={selected}
        onChange={handleChange}
      />
    </div>
  );
}
