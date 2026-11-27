import type { ReactNode } from 'react';

import styles from './stat-card.module.css';
import { cx } from './cx';

export type StatTrend = 'up' | 'down' | 'flat';

export type StatCardProps = {
  /** What the number counts: "Bài nộp 7 ngày qua". */
  label: string;
  /** The number, already formatted ("35", "5.6", `formatCount(1284)`). */
  value?: ReactNode;
  /** Smaller words after the number: "trên 18". */
  of?: ReactNode;
  /**
   * The comparison in words: "tăng 4 so với tuần trước". Always plain text
   * colour: going up or down is not good or bad by itself (ThanhPhanDuLieu §3).
   */
  comparison?: string;
  /** Arrow beside the comparison; decorative, the words are the signal. */
  trend?: StatTrend;
  /** Last line: period and scope, or a link ("Xem 4 học viên chưa học"). */
  context?: ReactNode;
  /**
   * `insufficient`: dashed frame, the number stays, `comparison` explains why
   * there is nothing to compare yet. `error`: the number is replaced by the
   * error words and `action` (e.g. "Tải lại").
   */
  state?: 'ready' | 'loading' | 'insufficient' | 'error';
  /** Error state: one next step, usually a "Tải lại" button. */
  action?: ReactNode;
  className?: string;
};

const ARROW: Record<StatTrend, string> = {
  up: 'M7 12V2M3 6l4-4 4 4',
  down: 'M7 2v10M3 8l4 4 4-4',
  flat: 'M2 7h10',
};

/**
 * Stat card of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhanDuLieu §3): one
 * number, a label saying what it counts and a comparison in words. At most
 * four a row (`StatCardGrid`), two a row on the phone with 32px numbers.
 */
export function StatCard({ label, value, of, comparison, trend, context, state = 'ready', action, className }: StatCardProps) {
  if (state === 'loading') {
    return (
      <div className={cx(styles.card, className)} aria-busy="true">
        <p className={styles.label}>{label}</p>
        <span aria-hidden="true" className={styles.skeleton}>
          <span className={styles.barValue} />
          <span className={styles.bar} />
          <span className={cx(styles.bar, styles.barShort)} />
        </span>
        <p role="status" className={styles.context}>Đang tải số liệu…</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={cx(styles.card, className)}>
        <p className={styles.label}>{label}</p>
        <p className={styles.errorTitle}>Chưa tải được số liệu</p>
        <p className={styles.errorBody}>Bài và điểm của học viên không bị ảnh hưởng.</p>
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
    );
  }

  return (
    <div className={cx(styles.card, state === 'insufficient' && styles.insufficient, className)}>
      <p className={styles.label}>{label}</p>
      <p className={styles.value}>
        {value}
        {of ? <span className={styles.of}> {of}</span> : null}
      </p>
      {comparison ? (
        <p className={styles.comparison}>
          {trend && state === 'ready' ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className={styles.arrow}>
              <path d={ARROW[trend]} fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          ) : null}
          {comparison}
        </p>
      ) : null}
      {context ? <p className={styles.context}>{context}</p> : null}
    </div>
  );
}

/** Row of stat cards: up to four a row, two on the phone. */
export function StatCardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.grid, className)}>{children}</div>;
}
