'use client';

import styles from './annotated-text.module.css';
import { cx } from './cx';

/** 1 Ngữ pháp (solid), 2 Từ vựng (wavy), 3 Mạch lạc (dashed), 4 Làm tốt (tint + double). */
export type AnnotationMark = 1 | 2 | 3 | 4;

export type AnnotatedSegment = { text: string; mark?: AnnotationMark; note?: number };
export type AnnotationNote = { number: number; label: string; body: string };

export type AnnotatedTextProps = {
  segments: AnnotatedSegment[];
  notes: AnnotationNote[];
  /** The selected note (outlined in the text and in the margin). */
  selected?: number;
  /** Makes the margin numbers buttons that select a note. */
  onSelect?: (number: number) => void;
  /** Language of the annotated text itself (an essay or transcript). */
  lang?: string;
  className?: string;
};

export const ANNOTATION_KINDS: Record<AnnotationMark, string> = {
  1: 'Ngữ pháp',
  2: 'Từ vựng',
  3: 'Mạch lạc',
  4: 'Làm tốt',
};

const MARK_CLASS: Record<AnnotationMark, string> = { 1: styles.grammar, 2: styles.vocab, 3: styles.coherence, 4: styles.good };

/**
 * Annotated essay or transcript of the "Bản in" UI (UIBASE-0056 FR-005,
 * ThanhPhanHocTap2 §7). The four kinds differ in their underline first, a
 * note number second and a text label in the margin third; colour is only a
 * fourth layer. From 768px the notes sit in a margin column; below, they
 * follow the text in number order.
 */
export function AnnotatedText({ segments, notes, selected, onSelect, lang = 'en', className }: AnnotatedTextProps) {
  const kindOf = new Map<number, AnnotationMark>();
  for (const s of segments) if (s.note != null && s.mark) kindOf.set(s.note, s.mark);

  return (
    <div className={cx(styles.annotated, className)}>
      <p className={styles.text} lang={lang}>
        {segments.map((s, i) => {
          if (!s.mark) return <span key={i}>{s.text}</span>;
          const on = s.note != null && s.note === selected;
          return (
            <span key={i}>
              <span className={cx(styles.mark, MARK_CLASS[s.mark], on && styles.on)}>{s.text}</span>
              {s.note != null ? (
                <sup className={styles.ref} lang="vi">
                  <span className={styles.hidden}>Chú thích </span>{s.note}
                  <span className={styles.hidden}>, {ANNOTATION_KINDS[s.mark]}</span>
                </sup>
              ) : null}
            </span>
          );
        })}
      </p>
      <ol className={styles.notes} aria-label="Chú thích">
        {notes.map((n) => {
          const mark = kindOf.get(n.number);
          const on = n.number === selected;
          const head = (
            <>
              <span className={styles.noteNum}>{n.number}</span>
              <span className={styles.noteLabel}>{n.label}</span>
            </>
          );
          return (
            <li key={n.number} className={cx(styles.note, mark && MARK_CLASS[mark], on && styles.noteOn)}>
              {onSelect ? (
                <button
                  type="button"
                  className={styles.noteHead}
                  aria-pressed={on}
                  aria-label={`Chú thích ${n.number}, ${n.label}`}
                  onClick={() => onSelect(n.number)}
                >
                  {head}
                </button>
              ) : (
                <p className={styles.noteHead}>{head}</p>
              )}
              <p className={styles.noteBody}>{n.body}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
