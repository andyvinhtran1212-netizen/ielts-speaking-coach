import type { ReactNode } from 'react';

import styles from './progress-bar.module.css';
import { cx } from './cx';
import { formatCount } from './format-count';

export type ProgressBarProps = {
  mode?: 'determinate' | 'indeterminate' | 'steps';
  /** Determinate: amount done. Steps: the current step, 1-based. */
  value?: number;
  /** Determinate: total. Steps: number of steps. */
  total?: number;
  /** Bold name above the bar, also the bar's accessible name. */
  label: string;
  /** Unit after the numbers: "13 trên 48 bài". */
  unit?: string;
  /** Steps mode: name of the current step ("Kiểm tra thử"). */
  stepLabel?: string;
  /** Line under the bar. Determinate at 100% defaults to "Đã xong". */
  note?: ReactNode;
  className?: string;
};

/**
 * Progress of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhanDuLieu §5).
 * Always says the progress in words ("13 trên 48 bài", never only a percent);
 * 8px bar, square ends; done turns the bar and the note to the "đạt" colour.
 */
export function ProgressBar({ mode = 'determinate', value = 0, total = 0, label, unit, stepLabel, note, className }: ProgressBarProps) {
  if (mode === 'indeterminate') {
    return (
      <div className={cx(styles.progress, className)}>
        <p className={styles.head}><span className={styles.label}>{label}</span></p>
        <div role="progressbar" aria-label={label} aria-valuetext="Đang xử lý" className={cx(styles.track, styles.moving)}>
          <span className={styles.runner} />
        </div>
        <p className={styles.note}>{note ?? 'Đang xử lý…'}</p>
      </div>
    );
  }

  if (mode === 'steps') {
    const steps = Math.max(1, total);
    const current = Math.min(Math.max(1, value), steps);
    const words = `Bước ${current} trên ${steps}`;
    return (
      <div className={cx(styles.progress, className)}>
        <p className={styles.head}>
          <span className={styles.label}>{label}</span>
          <span className={styles.count}>{words}</span>
        </p>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={1}
          aria-valuemax={steps}
          aria-valuenow={current}
          aria-valuetext={stepLabel ? `${words}, ${stepLabel}` : words}
          className={styles.segments}
          style={{ gridTemplateColumns: `repeat(${steps}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={cx(styles.segment, i + 1 < current && styles.segmentDone, i + 1 === current && styles.segmentCurrent)} />
          ))}
        </div>
        {note ? <p className={styles.note}>{note}</p> : null}
      </div>
    );
  }

  const max = Math.max(0, total);
  const now = Math.min(Math.max(0, value), max);
  const done = max > 0 && now === max;
  const words = `${formatCount(now)} trên ${formatCount(max)}${unit ? ` ${unit}` : ''}`;
  const percent = max > 0 ? (now / max) * 100 : 0;
  return (
    <div className={cx(styles.progress, done && styles.done, className)}>
      <p className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.count}>{words}</span>
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={now}
        aria-valuetext={done ? `${words}, đã xong` : words}
        className={styles.track}
      >
        {now > 0 ? <span className={styles.fill} style={{ width: `${percent}%` }} /> : null}
      </div>
      {note || done ? <p className={cx(styles.note, done && !note && styles.noteDone)}>{note ?? 'Đã xong'}</p> : null}
    </div>
  );
}
