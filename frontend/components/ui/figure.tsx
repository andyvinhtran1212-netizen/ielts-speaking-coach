import type { ReactNode } from 'react';

import styles from './figure.module.css';
import { cx } from './cx';

export type FigureProps = {
  /** The drawing, usually one inline <svg>. Without it the figure is a dashed placeholder. */
  children?: ReactNode;
  /** One sentence on what the figure shows, not a description of it. */
  caption: string;
  /** Read by screen readers instead of the drawing: what the figure contains. */
  alt: string;
  /** "Hình 14.2" (lesson number, dot, order in the lesson); bold, before the caption. */
  number?: string;
  /** Source line; self-drawn figures say "Aver Learning biên soạn". */
  source?: string;
  className?: string;
};

/**
 * Figure of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhanHocTap2 §8): a thin
 * line drawing on the surface colour with a 1px rule, then number, caption and
 * source. The drawing is one `role="img"` named by `alt`; its own text is
 * hidden from screen readers so it is not read twice.
 */
export function Figure({ children, caption, alt, number, source, className }: FigureProps) {
  return (
    <figure className={cx(styles.figure, className)}>
      {children ? (
        <div className={styles.frame} role="img" aria-label={alt}>
          <div aria-hidden="true" className={styles.art}>{children}</div>
        </div>
      ) : (
        <div className={cx(styles.frame, styles.placeholder)}>[MINH HOẠ: {alt}]</div>
      )}
      <figcaption className={styles.caption}>
        <span>
          {number ? <strong className={styles.number}>{number.endsWith('.') ? number : `${number}.`} </strong> : null}
          {caption}
        </span>
        {source ? <span className={styles.source}>Nguồn: {source}</span> : null}
      </figcaption>
    </figure>
  );
}
