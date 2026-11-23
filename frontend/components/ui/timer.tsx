'use client';

import { useEffect, useRef, useState } from 'react';

import styles from './timer.module.css';
import { cx } from './cx';
import { Icon } from './icon/icon';

export type TimerThreshold = {
  /** Seconds on the displayed clock. Countdown: reached when `seconds <= at`; countup: when `seconds >= at`. */
  at: number;
  /** Visible text from that point on ("5 minutes left", "Còn 15 giây", "Time is up"). */
  label: string;
  /** What a screen reader hears once when the mark is reached. Defaults to `label`. */
  announce?: string;
  /** Line under the clock from that point on. */
  note?: string;
};

export type TimerProps = {
  mode?: 'countdown' | 'countup';
  /** Seconds to show. The caller owns the clock (server time); Timer only draws it. */
  seconds: number;
  /** `en` in the exam room (mm:ss), `vi` in practice (m:ss). */
  lang?: 'en' | 'vi';
  /** Name above the clock before any mark ("Time remaining", "Đang ghi âm"). */
  label: string;
  /** Countup: the upper limit, shown as "/ tối đa 2:00". */
  max?: number;
  thresholds?: TimerThreshold[];
  /** Line under the clock before any mark ("Hết giờ sẽ tự bắt đầu ghi âm."). */
  note?: string;
  className?: string;
};

export function formatClock(total: number, pad: boolean): string {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const rest = String(s % 60).padStart(2, '0');
  return `${pad ? String(m).padStart(2, '0') : m}:${rest}`;
}

/** The furthest mark already reached, or null. */
export function activeThreshold(mode: 'countdown' | 'countup', seconds: number, thresholds: TimerThreshold[]): TimerThreshold | null {
  const reached = thresholds.filter((t) => (mode === 'countdown' ? seconds <= t.at : seconds >= t.at));
  if (!reached.length) return null;
  return reached.reduce((a, b) => (mode === 'countdown' ? (b.at < a.at ? b : a) : (b.at > a.at ? b : a)));
}

/**
 * Clock of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhanHocTap §4). Never
 * blinks; each mark changes the words, adds an icon and a thicker rule, and is
 * read to screen readers exactly once. Digits are tabular so nothing jumps.
 */
export function Timer({ mode = 'countdown', seconds, lang = 'vi', label, max, thresholds = [], note, className }: TimerProps) {
  const pad = lang === 'en';
  const mark = activeThreshold(mode, seconds, thresholds);
  const announced = useRef(new Set<number>());
  const [message, setMessage] = useState('');

  useEffect(() => {
    // A mark not reached any more (the clock was reset for the next part)
    // can be announced again when it is reached again.
    for (const at of [...announced.current]) {
      const stillReached = mode === 'countdown' ? seconds <= at : seconds >= at;
      if (!stillReached) announced.current.delete(at);
    }
  }, [mode, seconds]);

  useEffect(() => {
    if (!mark || announced.current.has(mark.at)) return;
    announced.current.add(mark.at);
    setMessage(mark.announce ?? mark.label);
  }, [mark]);

  const clock = formatClock(seconds, pad);
  const limit = mode === 'countup' && typeof max === 'number'
    ? (lang === 'en' ? `/ max ${formatClock(max, pad)}` : `/ tối đa ${formatClock(max, pad)}`)
    : null;
  const line = mark?.note ?? note;

  return (
    <div className={cx(styles.timer, mark && styles.marked, className)} lang={lang}>
      <p className={styles.label}>
        {mark ? <Icon name="warning" size={16} className={styles.icon} /> : null}
        {mark ? mark.label : label}
      </p>
      <p className={styles.clock}>
        <span className={styles.digits}>{clock}</span>
        {limit ? <span className={styles.limit}> {limit}</span> : null}
      </p>
      {line ? <p className={styles.note}>{line}</p> : null}
      <p className={styles.live} aria-live="polite" aria-atomic="true">{message}</p>
    </div>
  );
}
