'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import styles from './tabs.module.css';
import { cx } from './cx';

export type TabItem = {
  id: string;
  label: string;
  /** Shown as "Bài được giao (4)". */
  count?: number;
  /** All items with `href` → a `<nav>` of links instead of a tablist. */
  href?: string;
};

export type TabsProps = {
  items: readonly TabItem[];
  active: string;
  /** Accessible name of the tablist or nav, e.g. "Bài của tôi". */
  label: string;
  /** Tablist mode: called with the item id on click and on arrow keys. */
  onChange?: (id: string) => void;
  /** Tablist mode: content of the active tab, rendered as its tabpanel. */
  children?: ReactNode;
  className?: string;
};

const text = (item: TabItem) => (item.count === undefined ? item.label : `${item.label} (${item.count})`);

/**
 * Tabs of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhan §6). Without `href`:
 * ARIA tablist with roving tabindex, ←/→/Home/End move and select (automatic
 * activation). With `href` on every item: a `<nav>` of links, the active one
 * `aria-current="page"`, because changing the URL is navigation.
 */
export function Tabs({ items, active, label, onChange, children, className }: TabsProps) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  if (items.length > 0 && items.every((item) => item.href)) {
    return (
      <nav aria-label={label} className={cx(styles.tabs, className)}>
        {items.map((item) => (
          <a
            key={item.id}
            href={item.href}
            aria-current={item.id === active ? 'page' : undefined}
            className={cx(styles.tab, item.id === active && styles.active)}
          >
            {text(item)}
          </a>
        ))}
      </nav>
    );
  }

  const index = Math.max(0, items.findIndex((item) => item.id === active));
  const select = (next: number) => {
    const target = (next + items.length) % items.length;
    refs.current[target]?.focus();
    onChange?.(items[target].id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: items.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    select(moves[event.key]);
  };

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className={styles.tabs}>
        {items.map((item, i) => {
          const selected = i === index;
          return (
            <button
              key={item.id}
              ref={(node) => { refs.current[i] = node; }}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={children ? `${base}-panel` : undefined}
              tabIndex={selected ? 0 : -1}
              className={cx(styles.tab, selected && styles.active)}
              onClick={() => onChange?.(item.id)}
              onKeyDown={onKeyDown}
            >
              {text(item)}
            </button>
          );
        })}
      </div>
      {children ? (
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${items[index]?.id}`} tabIndex={0} className={styles.panel}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
