'use client';

// EXAMROOM-0066 FR-003–FR-005: two columns with a draggable separator, the
// ratio kept per attempt; under 900px two tabs that each keep their scroll.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import {
  clampRatio,
  ratioForKey,
  ratioFromPointer,
  readSplitRatio,
  splitLayout,
  writeSplitRatio,
} from '@/lib/exam-room/split-ratio.mjs';

import { cx } from '../ui/cx';
import styles from './exam-room.module.css';

function safeStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export type SplitPaneProps = {
  attemptKey: string;
  left: ReactNode;
  right: ReactNode;
  leftLabel: string;
  rightLabel: string;
  /** Viewport width; decides split or tabs. */
  width: number;
  /** Accessible name of the separator, e.g. "Resize passage and questions". */
  separatorLabel: string;
  /**
   * Time up, read-only tab or blocked session: every answer field is disabled,
   * while the tabs and the separator keep working so the learner can still read.
   */
  locked?: boolean;
};

function Locked({ locked, children }: { locked: boolean; children: ReactNode }) {
  return <fieldset className={styles.lock} disabled={locked}>{children}</fieldset>;
}

export function SplitPane({ attemptKey, left, right, leftLabel, rightLabel, width, separatorLabel, locked = false }: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [preference, setPreference] = useState(() => readSplitRatio(safeStorage(), attemptKey));
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<'left' | 'right'>('left');
  const layout = splitLayout(width);

  useEffect(() => { setPreference(readSplitRatio(safeStorage(), attemptKey)); }, [attemptKey]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const measure = () => setContainerWidth(node.getBoundingClientRect().width || undefined);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [layout]);

  // The preference is stored; the drawn ratio is clamped to the room the window has (FR-004).
  const ratio = clampRatio(preference, containerWidth);
  const choose = (next: number) => {
    setPreference(next);
    writeSplitRatio(safeStorage(), attemptKey, next);
  };

  const pointerRatio = (event: PointerEvent<HTMLDivElement>) => {
    const node = containerRef.current;
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return ratioFromPointer(event.clientX - box.left, box.width);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* jsdom */ }
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const next = pointerRatio(event);
    if (next != null) setPreference(next);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    const next = pointerRatio(event);
    choose(next ?? preference);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = ratioForKey(preference, event.key, containerWidth);
    if (next == null) return;
    event.preventDefault();
    choose(next);
  };

  if (layout === 'tabs') {
    return (
      <div className={styles.tabsLayout} ref={containerRef}>
        <div role="tablist" className={styles.paneTabs} aria-label={`${leftLabel} / ${rightLabel}`}>
          {(['left', 'right'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`exam-room-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`exam-room-panel-${id}`}
              className={styles.paneTab}
              onClick={() => setTab(id)}
            >
              {id === 'left' ? leftLabel : rightLabel}
            </button>
          ))}
        </div>
        {/* Both panels stay mounted so each keeps its own scroll position (FR-005). */}
        <section id="exam-room-panel-left" role="tabpanel" aria-labelledby="exam-room-tab-left" hidden={tab !== 'left'} className={styles.pane}><Locked locked={locked}>{left}</Locked></section>
        <section id="exam-room-panel-right" role="tabpanel" aria-labelledby="exam-room-tab-right" hidden={tab !== 'right'} className={styles.pane}><Locked locked={locked}>{right}</Locked></section>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cx(styles.split, dragging && styles.dragging)}
      style={{ gridTemplateColumns: `${ratio}fr auto ${100 - ratio}fr` }}
    >
      <section className={styles.pane} aria-label={leftLabel}><Locked locked={locked}>{left}</Locked></section>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={separatorLabel}
        aria-valuemin={30}
        aria-valuemax={70}
        aria-valuenow={ratio}
        tabIndex={0}
        className={styles.separator}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => choose(ratioForKey(preference, 'dblclick', containerWidth) ?? 50)}
        onKeyDown={onKeyDown}
      />
      <section className={styles.pane} aria-label={rightLabel}><Locked locked={locked}>{right}</Locked></section>
    </div>
  );
}
