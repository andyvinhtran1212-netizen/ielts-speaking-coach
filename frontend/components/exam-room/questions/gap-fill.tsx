'use client';

// EXAMROOM-0066 FR-025: a gap inside the sentence (prompt with `__` or longer),
// or an input after the prompt when it has none. The word limit printed on the
// paper is shown as is.
import { inlineGap } from './answer-codec.mjs';
import { GapInput } from './gap-input';
import styles from './questions.module.css';
import type { AnswerProps } from './types';

export function GapFill({ q, prompt, wordLimit, kind = 'gap', ...props }: AnswerProps & {
  q: number; prompt: string; wordLimit?: string | null; kind?: 'gap' | 'short-answer';
}) {
  const split = inlineGap(prompt);
  return (
    <div className={styles.question} id={`q-${q}`} data-q={q} data-question-kind={kind}>
      <p className={styles.prompt}>
        <span className={styles.qNum}>{q}</span>{' '}
        {split
          ? <>{split.before}<GapInput {...props} q={q} />{split.after}</>
          : <>{prompt} <GapInput {...props} q={q} /></>}
      </p>
      {wordLimit ? <p className={styles.hint}>{props.strings.wordLimit(wordLimit)}</p> : null}
    </div>
  );
}
