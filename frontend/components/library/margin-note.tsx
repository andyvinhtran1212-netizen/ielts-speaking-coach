'use client';

/**
 * Margin notes of the Library reading template (LIBRARY-0061 T007, FR-021,
 * FR-022; tờ KienThucWriting §2 mục 1–3, §3).
 *
 * - `NoteRef` + `MarginNote`: a numbered footnote in running text; the number is
 *   superscript in the paragraph and the note sits in the right column (narrow
 *   screens: right under the paragraph, via ReadingBlock).
 * - `AnnotatedSample`: a sample paragraph whose phrases carry numbers. Pressing
 *   a number (in the text or in the margin) highlights exactly the phrase with
 *   that `data-anchor`; pressing it again removes the highlight. Numbers start
 *   from 1 in every sample paragraph.
 */
import { useState, type ReactNode } from 'react';

import { ReadingBlock } from './reading-layout';
import styles from './margin-note.module.css';

export function NoteRef({ n }: { n: number | string }) {
  return <sup className={styles.ref}>{n}</sup>;
}

export type MarginNoteProps = { n: number | string; children: ReactNode };

export function MarginNote({ n, children }: MarginNoteProps) {
  return (
    <p className={styles.note}>
      <span className={styles.noteNum}>{n}</span> {children}
    </p>
  );
}

/** A plain run of text, or a phrase that a note explains. */
export type SamplePart = string | { anchor: string; text: string };

export type SampleNote = {
  /** Matches the `anchor` of one phrase in `parts`. */
  anchor: string;
  /** Small caps label above the note, e.g. the full criterion name. */
  kind?: string;
  text: ReactNode;
};

export type NumberedSampleNote = SampleNote & { n: number; linked: boolean };

/**
 * Numbers the notes of one sample paragraph from 1, in the order their phrase
 * appears in the text; notes whose phrase is missing keep their place after the
 * linked ones and cannot be pressed. Exported for tests.
 */
export function numberSampleNotes(
  parts: readonly SamplePart[],
  notes: readonly SampleNote[],
): NumberedSampleNote[] {
  const order = parts
    .filter((p): p is { anchor: string; text: string } => typeof p !== 'string')
    .map((p) => p.anchor);
  const linked = notes
    .filter((note) => order.includes(note.anchor))
    .sort((a, b) => order.indexOf(a.anchor) - order.indexOf(b.anchor));
  const unlinked = notes.filter((note) => !order.includes(note.anchor));
  return [...linked, ...unlinked].map((note, i) => ({
    ...note,
    n: i + 1,
    linked: order.includes(note.anchor),
  }));
}

export type AnnotatedSampleProps = {
  /** Small caps line above the paragraph, e.g. "Ví dụ minh hoạ · Aver Learning viết". */
  label?: string;
  parts: readonly SamplePart[];
  notes: readonly SampleNote[];
  /** Language of the sample text (samples are English). */
  lang?: string;
};

export function AnnotatedSample({ label, parts, notes, lang = 'en' }: AnnotatedSampleProps) {
  const [active, setActive] = useState<string | null>(null);
  const numbered = numberSampleNotes(parts, notes);
  const byAnchor = new Map(numbered.map((note) => [note.anchor, note]));
  const toggle = (anchor: string) => setActive((current) => (current === anchor ? null : anchor));

  const marginList = (
    <ol className={styles.sampleNotes}>
      {numbered.map((note) => {
        const pressed = note.linked && active === note.anchor;
        return (
          <li key={note.anchor} className={pressed ? `${styles.sampleNote} ${styles.chosen}` : styles.sampleNote}>
            {note.linked ? (
              <button
                type="button"
                className={styles.numButton}
                aria-pressed={pressed}
                aria-label={`Chú thích ${note.n}`}
                onClick={() => toggle(note.anchor)}
              >
                {note.n}
              </button>
            ) : (
              <span className={styles.numStatic}>{note.n}</span>
            )}
            <div>
              {note.kind ? (
                <p className={styles.kind}>
                  {note.kind}
                  {pressed ? ' · đang chọn' : ''}
                </p>
              ) : null}
              <div className={styles.noteText}>{note.text}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );

  return (
    <ReadingBlock notes={numbered.length > 0 ? marginList : undefined}>
      {label ? <p className={styles.label}>{label}</p> : null}
      <p lang={lang} className={styles.sample}>
        {parts.map((part, i) => {
          if (typeof part === 'string') return <span key={i}>{part}</span>;
          const note = byAnchor.get(part.anchor);
          const on = active === part.anchor;
          return (
            <span key={i}>
              <span data-anchor={part.anchor} data-active={on ? 'true' : undefined} className={on ? styles.on : undefined}>
                {part.text}
              </span>
              {note ? (
                <button
                  type="button"
                  className={styles.supButton}
                  aria-pressed={on}
                  aria-label={`Chú thích ${note.n}`}
                  onClick={() => toggle(part.anchor)}
                >
                  {note.n}
                </button>
              ) : null}
            </span>
          );
        })}
      </p>
    </ReadingBlock>
  );
}
