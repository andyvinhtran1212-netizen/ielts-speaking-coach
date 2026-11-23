'use client';

import styles from './question-palette.module.css';
import { cx } from './cx';
import { Icon } from './icon/icon';

export type QuestionState = 'unanswered' | 'answered' | 'flagged' | 'current' | 'correct' | 'wrong' | 'blank';

export type QuestionItem = {
  num: number;
  /** `flagged` and `current` alone mean an unanswered question with that mark. */
  state: QuestionState;
  /** Flag for review on top of `answered`/`unanswered` (both can be true at once). */
  flagged?: boolean;
  /** The question on screen (thick outline, `aria-current`). */
  current?: boolean;
};

export type QuestionPaletteProps = {
  /** `en` in the exam room, `vi` in practice; one palette never mixes them. */
  lang?: 'en' | 'vi';
  items: QuestionItem[];
  /** Group name above the cells ("Part 1 · Questions 1–13", "Câu 1–13"). */
  title?: string;
  onSelect?: (num: number) => void;
  className?: string;
};

type Resolved = { num: number; base: 'unanswered' | 'answered' | 'correct' | 'wrong' | 'blank'; flagged: boolean; current: boolean };

function resolve(item: QuestionItem): Resolved {
  const base = item.state === 'flagged' || item.state === 'current' ? 'unanswered' : item.state;
  return {
    num: item.num,
    base,
    flagged: Boolean(item.flagged) || item.state === 'flagged',
    current: Boolean(item.current) || item.state === 'current',
  };
}

const WORDS = {
  en: {
    question: 'Question', unanswered: 'not answered', answered: 'answered', correct: 'correct', wrong: 'wrong',
    blank: 'left blank', flagged: 'flagged for review', current: 'current question',
  },
  vi: {
    question: 'Câu', unanswered: 'chưa trả lời', answered: 'đã trả lời', correct: 'đúng', wrong: 'sai',
    blank: 'bỏ trống', flagged: 'đánh dấu xem lại', current: 'đang ở câu này',
  },
} as const;

/** Full spoken name of one cell: "Question 18, answered, flagged for review". */
export function questionCellName(item: QuestionItem, lang: 'en' | 'vi' = 'vi'): string {
  const r = resolve(item);
  const w = WORDS[lang];
  return [`${w.question} ${r.num}`, w[r.base], r.flagged ? w.flagged : null, r.current ? w.current : null].filter(Boolean).join(', ');
}

/** Line above the cells: "Answered 12 of 40", "Đúng 9 trên 13 câu · sai 2 · bỏ trống 2". */
export function paletteSummary(items: QuestionItem[], lang: 'en' | 'vi' = 'vi'): string {
  const all = items.map(resolve);
  const graded = all.some((r) => r.base === 'correct' || r.base === 'wrong' || r.base === 'blank');
  const count = (b: Resolved['base']) => all.filter((r) => r.base === b).length;
  if (graded) {
    return lang === 'en'
      ? `${count('correct')} of ${all.length} correct · ${count('wrong')} wrong · ${count('blank')} blank`
      : `Đúng ${count('correct')} trên ${all.length} câu · sai ${count('wrong')} · bỏ trống ${count('blank')}`;
  }
  return lang === 'en' ? `Answered ${count('answered')} of ${all.length}` : `Đã trả lời ${count('answered')} trên ${all.length} câu`;
}

const GRADED_ICON = { correct: 'check', wrong: 'close', blank: 'minus' } as const;

/**
 * Question palette of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhanHocTap2 §5).
 * Every state differs in fill, rule or icon (never colour alone) and has a
 * full spoken name; the current question has a thick outline.
 */
export function QuestionPalette({ lang = 'vi', items, title, onSelect, className }: QuestionPaletteProps) {
  const summary = paletteSummary(items, lang);
  const groupName = title ?? (lang === 'en' ? 'Questions' : 'Bảng câu hỏi');
  return (
    <div className={cx(styles.palette, className)} lang={lang}>
      <p className={styles.head}>
        {title ? <span className={styles.title}>{title}</span> : null}
        <span className={styles.summary}>{summary}</span>
      </p>
      <ul className={styles.cells} aria-label={groupName}>
        {items.map((item) => {
          const r = resolve(item);
          const graded = r.base === 'correct' || r.base === 'wrong' || r.base === 'blank';
          return (
            <li key={r.num}>
              <button
                type="button"
                className={cx(styles.cell, styles[r.base], r.flagged && styles.flagged, r.current && styles.current)}
                aria-label={questionCellName(item, lang)}
                aria-current={r.current ? 'true' : undefined}
                onClick={onSelect ? () => onSelect(r.num) : undefined}
              >
                <span className={styles.num} aria-hidden="true">{r.num}</span>
                {graded ? <Icon name={GRADED_ICON[r.base as keyof typeof GRADED_ICON]} size={16} className={styles.mark} /> : null}
                {r.flagged ? <Icon name="flag" size={16} className={styles.flag} /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
