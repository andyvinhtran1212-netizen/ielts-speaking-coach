'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { registerNavigationGuard } from '@/lib/navigation-guard';

import { cx } from '../cx';
import { EXAM_ROOM_FOLLOWS_THEME } from './focus-config';
import { FOCUS_WORDS, type FocusLeaveCopy, type FocusMode } from './focus-copy';
import { LeaveConfirm } from './focus-leave-confirm';
import styles from './focus-shell.module.css';

export type { FocusLeaveCopy, FocusMode } from './focus-copy';

export type FocusShellProps = {
  /** `practice`: paper bar, Vietnamese. `exam`: ink bar, English only. */
  mode: FocusMode;
  /** Name of the exercise or test, cut with "…" when long. */
  title: string;
  /** Regular-weight part after the title, e.g. "Passage 1 of 3". */
  detail?: string;
  /** Where "‹ Thoát" / "‹ Leave test" goes. A full page load, so it may be a v1 page. */
  exitHref: string;
  /** True while leaving would lose work. Read on each exit, tab close and reload. */
  hasUnsavedWork: () => boolean;
  /** Right of the bar: timer, progress or save state (`FocusTimer`, `FocusStatus`). */
  right?: ReactNode;
  /**
   * Phone only (<768px): a muted line under the bar, e.g. "Câu 3 trên 13 · đã lưu lúc 10:42".
   * Plain `FocusStatus` items and the timer label leave the bar there to keep room for the title.
   */
  subline?: ReactNode;
  /** A strip under the content, e.g. the question bar and "Submit test". */
  bottom?: ReactNode;
  /** Exam room, self-selected tests only: shows "Abandon test"; the page owns its box (G08). */
  onAbandon?: () => void;
  /** Runs after the learner confirms leaving, before the page goes (e.g. drop the recording). */
  onLeave?: () => void;
  /** Replaces words of the leave box for this page. */
  leaveCopy?: Partial<FocusLeaveCopy>;
  /**
   * The full-test room, which stays light (FR-025). Default: on in `exam`.
   * Course tests pass `false` to follow the site theme.
   */
  fullTestRoom?: boolean;
  /** `/ui-library` and tests only: a <div> instead of <main>, no skip link, no guard. */
  demo?: boolean;
  children: ReactNode;
};

/**
 * Frame of timed work and recording (UIBASE-0056 FR-009, ThanhPhanKhungTrang §6,
 * PhongThi §4a). Exit on the left, title in the middle, a slot on the right;
 * no footer, AI credits, account button, bell or bottom bar, and never the
 * learner's name or email.
 *
 * Leaving: practice leaves at once when nothing would be lost and asks
 * otherwise; the exam room always asks, because the server timer keeps
 * running. The same `hasUnsavedWork` also guards tab close, reload and links
 * through `registerNavigationGuard`.
 */
export function FocusShell({
  mode,
  title,
  detail,
  exitHref,
  hasUnsavedWork,
  right,
  subline,
  bottom,
  onAbandon,
  onLeave,
  leaveCopy,
  fullTestRoom = mode === 'exam',
  demo = false,
  children,
}: FocusShellProps) {
  const words = FOCUS_WORDS[mode];
  const [asking, setAsking] = useState(false);
  const unsaved = useRef(hasUnsavedWork);
  const leaving = useRef(false);
  unsaved.current = hasUnsavedWork;

  useEffect(() => {
    if (demo) return undefined;
    return registerNavigationGuard((event) => {
      if (leaving.current || !unsaved.current()) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }, [demo]);

  const leave = useCallback(() => {
    setAsking(false);
    leaving.current = true;
    onLeave?.();
    window.location.assign(exitHref);
  }, [exitHref, onLeave]);

  const requestExit = () => {
    if (mode === 'exam' || unsaved.current()) setAsking(true);
    else leave();
  };

  const copy: FocusLeaveCopy = { ...words.leave, ...leaveCopy };
  const light = mode === 'exam' && fullTestRoom && !EXAM_ROOM_FOLLOWS_THEME;

  return (
    <div
      className={cx(styles.shell, styles[mode], light && 'av2-always-light')}
      data-demo={demo ? '' : undefined}
      lang={mode === 'exam' ? 'en' : undefined}
    >
      {demo ? null : <a href="#focus-content" className={styles.skip}>{words.skip}</a>}
      <header className={styles.bar}>
        <div className={styles.start}>
          <button type="button" className={styles.exit} aria-haspopup="dialog" onClick={requestExit}>
            <span aria-hidden="true">‹</span>{words.exit}
          </button>
          {mode === 'exam' && onAbandon ? (
            <button type="button" className={styles.exit} aria-haspopup="dialog" onClick={onAbandon}>
              {FOCUS_WORDS.exam.abandon}
            </button>
          ) : null}
        </div>
        <p className={styles.title}>
          {mode === 'exam' ? <strong>{title}</strong> : title}
          {detail ? <span className={styles.detail}> · {detail}</span> : null}
        </p>
        <div className={styles.end}>{right}</div>
      </header>
      {subline ? <p className={styles.subline}>{subline}</p> : null}
      {demo
        ? <div className={styles.content}>{children}</div>
        : <main id="focus-content" tabIndex={-1} className={styles.content}>{children}</main>}
      {bottom ? <div className={styles.bottom}>{bottom}</div> : null}
      <LeaveConfirm open={asking} mode={mode} copy={copy} onStay={() => setAsking(false)} onLeave={leave} />
    </div>
  );
}

/** The countdown on the right of the bar; boxed in the exam room. */
export function FocusTimer({ label, value }: { label: string; value: string }) {
  return (
    <span className={styles.timerGroup}>
      <span aria-hidden="true" className={styles.timerLabel}>{label}</span>
      <span role="timer" aria-label={label} className={styles.timer}>{value}</span>
    </span>
  );
}

/** Small status text on the bar: "Saved at 10:42", "Câu 2 trên 5", "Đang lưu…". */
export function FocusStatus({ children, tone }: { children: ReactNode; tone?: 'recording' }) {
  return (
    <span className={cx(styles.status, tone === 'recording' && styles.recording)}>
      {tone === 'recording' ? <span aria-hidden="true" className={styles.dot} /> : null}
      {children}
    </span>
  );
}
