import type { ReactNode } from 'react';

import styles from './page-state.module.css';
import { cx } from './cx';

export type PageStateKind = 'empty' | 'error' | 'loading' | 'locked';

export type PageStateProps = {
  kind: PageStateKind;
  /** Required except for `loading`, where it is read by screen readers only. */
  title?: string;
  body?: ReactNode;
  /** One next step: a link or a button ("Tải lại", "Xem các khoá"). */
  action?: ReactNode;
  /** Word line above the title; defaults to the sheet's words. */
  label?: string;
  className?: string;
};

const LABELS: Record<PageStateKind, string> = {
  empty: 'Trống',
  error: 'Lỗi',
  loading: 'Đang tải',
  locked: 'Cần khoá học',
};

/**
 * Whole-area state of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhan §5):
 * empty, error, loading (skeleton + `role="status"` text) and locked.
 */
export function PageState({ kind, title, body, action, label, className }: PageStateProps) {
  const word = label ?? LABELS[kind];
  if (kind === 'loading') {
    return (
      <div role="status" aria-busy="true" className={cx(styles.state, className)}>
        <p className={styles.label}>{word}</p>
        {title ? <span className={styles.visuallyHidden}>{title}</span> : null}
        <span aria-hidden="true" className={styles.skeleton}>
          <span className={styles.barTitle} />
          <span className={styles.bar} />
          <span className={cx(styles.bar, styles.w86)} />
          <span className={cx(styles.bar, styles.w54)} />
        </span>
      </div>
    );
  }
  return (
    <div className={cx(styles.state, kind === 'locked' && styles.locked, className)}>
      <p className={cx(styles.label, kind === 'error' && styles.labelError)}>{word}</p>
      <h2 className={styles.title}>{title}</h2>
      {body ? <p className={styles.body}>{body}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
