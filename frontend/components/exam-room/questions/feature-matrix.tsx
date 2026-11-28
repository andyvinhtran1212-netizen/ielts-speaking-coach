'use client';

// EXAMROOM-0066 FR-027: matching features as a matrix, one radio per option in
// each statement's row. The stored answer is the option's value. The table
// scrolls sideways inside its own frame on a narrow screen.
import type { ExamRoomOption } from './answer-codec.mjs';
import { OptionBank } from './matching';
import styles from './questions.module.css';
import type { AnswerProps, PromptedQuestion } from './types';

export function FeatureMatrix({ options, questions, bankTitle, answers, onAnswer, readOnly, strings }: AnswerProps & {
  options: readonly ExamRoomOption[];
  questions: readonly PromptedQuestion[];
  bankTitle?: string;
}) {
  const first = questions[0]?.q ?? 0;
  const last = questions[questions.length - 1]?.q ?? first;
  return (
    <div className={styles.group} data-question-kind="matrix">
      <OptionBank title={bankTitle ?? strings.options} options={options} strings={strings} />
      <div className={styles.tableWrap} role="region" aria-label={strings.questionRange(first, last)} tabIndex={0}>
        <table className={styles.table}>
          <thead><tr><th scope="col">{strings.statement}</th>{options.map((option) => <th scope="col" key={option.value}>{option.value}</th>)}</tr></thead>
          <tbody>{questions.map(({ q, prompt }) => (
            <tr key={q} id={`q-${q}`} data-q={q} data-answered={answers[q] ? 'true' : undefined}>
              <th scope="row"><span className={styles.qNum}>{q}</span> {prompt}</th>
              {options.map((option) => (
                <td key={option.value}>
                  <input
                    type="radio"
                    className={styles.radio}
                    name={`q-${q}`}
                    value={option.value}
                    aria-label={`${strings.questionLabel(q)}: ${option.value}`}
                    checked={(answers[q] ?? '') === option.value}
                    disabled={readOnly}
                    onChange={() => onAnswer(q, option.value)}
                  />
                </td>
              ))}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
