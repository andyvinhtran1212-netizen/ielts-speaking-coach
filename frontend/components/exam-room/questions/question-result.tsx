'use client';

// EXAMROOM-0066 FR-026: after grading, in the practice room only. Right/wrong
// in words (never colour alone), the correct answer and one line of
// explanation, plus "9 of 13 correct". No band is shown here, and nothing at
// all when there is nothing to count (never "0/0").
import { scoreText } from './answer-codec.mjs';
import styles from './questions.module.css';
import type { QuestionStrings } from './types';

export type GradedQuestion = {
  q: number;
  userAnswer: string;
  expected: string;
  correct: boolean;
  explanation?: string | null;
};

export function QuestionResult({ result, strings }: { result: GradedQuestion; strings: QuestionStrings }) {
  const answered = result.userAnswer.trim() !== '';
  const verdict = result.correct ? strings.correct : answered ? strings.incorrect : strings.unanswered;
  return (
    <div className={styles.result} data-q={result.q} data-verdict={result.correct ? 'correct' : answered ? 'incorrect' : 'unanswered'}>
      <p className={styles.verdict}><strong>{strings.questionLabel(result.q)}: {verdict}</strong></p>
      <dl className={styles.resultList}>
        <div><dt>{strings.yourAnswer}</dt><dd>{answered ? result.userAnswer : '—'}</dd></div>
        {!result.correct ? <div><dt>{strings.correctAnswer}</dt><dd>{result.expected}</dd></div> : null}
      </dl>
      {result.explanation ? <p className={styles.explanation}>{result.explanation}</p> : null}
    </div>
  );
}

export function ScoreLine({ correct, total, strings }: { correct: number; total: number; strings: QuestionStrings }) {
  const text = scoreText({ correct, total }, strings);
  return text ? <p className={styles.score} role="status">{text}</p> : null;
}
