'use client';

// EXAMROOM-0066 FR-025: matching headings / information / sentence endings. A
// bank of options and one select per question; an option another question
// already uses is struck through and dimmed in the bank, with a hidden
// "(used in Q6)". Options stay selectable (IELTS allows reuse when the paper
// says so). The stored answer is the option's value.
import { Select } from '@/components/ui';

import { optionUsage, type ExamRoomOption } from './answer-codec.mjs';
import styles from './questions.module.css';
import type { AnswerProps, PromptedQuestion } from './types';

export function OptionBank({ title, options, usage, strings }: {
  title: string; options: readonly ExamRoomOption[]; usage?: Map<string, number[]>; strings: AnswerProps['strings'];
}) {
  if (!options.length) return null;
  return (
    <aside className={styles.bank} aria-label={title}>
      <p className={styles.bankTitle}>{title}</p>
      <ul className={styles.bankList}>{options.map((option) => {
        const used = usage?.get(option.value) ?? [];
        return (
          <li key={option.value} className={used.length ? styles.used : undefined} data-used={used.length ? 'true' : undefined}>
            {option.prefix ? <strong>{option.prefix}</strong> : null} <span>{option.text}</span>
            {used.length ? <span className={styles.srOnly}> {strings.usedIn(used)}</span> : null}
          </li>
        );
      })}</ul>
    </aside>
  );
}

export function Matching({ bankTitle, options, choices, questions, answers, onAnswer, readOnly, strings }: AnswerProps & {
  bankTitle: string;
  /** Options listed in the bank. */
  options: readonly ExamRoomOption[];
  /** Values offered in each select; defaults to the bank's values (Reading matching_information may offer paragraph letters only). */
  choices?: readonly string[];
  questions: readonly PromptedQuestion[];
}) {
  const usage = optionUsage([...questions], answers);
  const values = choices ?? options.map((option) => option.value);
  return (
    <div className={styles.group} data-question-kind="matching">
      <OptionBank title={bankTitle} options={options} usage={usage} strings={strings} />
      <div className={styles.rows}>{questions.map(({ q, prompt }) => (
        <div className={styles.row} id={`q-${q}`} data-q={q} key={q}>
          <span className={styles.qNum} aria-hidden="true">{q}</span>
          <Select
            label={`${strings.questionLabel(q)}. ${prompt}`}
            name={`q-${q}`}
            value={answers[q] ?? ''}
            disabled={readOnly}
            options={[{ value: '', label: strings.selectPlaceholder }, ...values.map((value) => ({ value, label: value }))]}
            onChange={(value) => onAnswer(q, value)}
          />
        </div>
      ))}</div>
    </div>
  );
}
