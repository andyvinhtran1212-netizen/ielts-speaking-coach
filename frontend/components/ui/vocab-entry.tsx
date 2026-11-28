import type { ReactNode } from 'react';

import styles from './vocab-entry.module.css';
import { cx } from './cx';

export type VocabEntryProps = {
  /** `full` in Sổ từ, Thư viện and after a reading; `popover` next to a tapped word. */
  variant?: 'full' | 'popover';
  headword: string;
  /** Without slashes: "əˈfɔːdəbl". */
  ipa?: string;
  /** Part of speech in Vietnamese ("tính từ"). */
  pos?: string;
  defEn?: string;
  defVi?: string;
  /** The example sentence; wrap the headword in <strong> to mark it. */
  example?: ReactNode;
  collocations?: string[];
  /** Play button for the word's audio (the caller owns playback). */
  audio?: ReactNode;
  /** Save / "Xem đủ mục từ" controls, rendered last. */
  actions?: ReactNode;
  className?: string;
};

/**
 * Dictionary-style word entry of the "Bản in" UI (UIBASE-0056 FR-005,
 * ThanhPhanHocTap2 §6). The order is fixed: word, pronunciation, part of
 * speech, English meaning, Vietnamese meaning, example, collocations. IPA is
 * set in `.av2-ipa` so every IPA glyph renders in the sans face.
 */
export function VocabEntry({
  variant = 'full', headword, ipa, pos, defEn, defVi, example, collocations, audio, actions, className,
}: VocabEntryProps) {
  if (variant === 'popover') {
    return (
      <div className={cx(styles.entry, styles.popover, className)}>
        <p className={styles.headRow}>
          <span lang="en" className={styles.headwordSm}>{headword}</span>
          {audio}
        </p>
        <p className={styles.meta}>
          {ipa ? <span className={cx('av2-ipa', styles.ipa)} lang="en">/{ipa}/</span> : null}
          {ipa && pos ? <span aria-hidden="true"> · </span> : null}
          {pos ? <span className={styles.pos}>{pos}</span> : null}
        </p>
        {defVi ? <p className={styles.defVi}>{defVi}</p> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    );
  }

  return (
    <article className={cx(styles.entry, styles.full, className)} aria-label={headword}>
      <header className={styles.head}>
        <h3 lang="en" className={styles.headword}>{headword}</h3>
        <p className={styles.meta}>
          {ipa ? <span className={cx('av2-ipa', styles.ipa)} lang="en">/{ipa}/</span> : null}
          {audio}
          {pos ? <span className={styles.pos}>{pos}</span> : null}
        </p>
      </header>
      <dl className={styles.fields}>
        {defEn ? (
          <div className={styles.field}><dt>Nghĩa tiếng Anh</dt><dd lang="en">{defEn}</dd></div>
        ) : null}
        {defVi ? (
          <div className={styles.field}><dt>Nghĩa tiếng Việt</dt><dd>{defVi}</dd></div>
        ) : null}
        {example ? (
          <div className={styles.field}><dt>Ví dụ</dt><dd lang="en" className={styles.example}>{example}</dd></div>
        ) : null}
        {collocations?.length ? (
          <div className={styles.field}><dt>Collocation</dt><dd lang="en">{collocations.join(' · ')}</dd></div>
        ) : null}
      </dl>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </article>
  );
}
