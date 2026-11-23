'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Icon } from '../icon/icon';
import styles from './staff-shell.module.css';

export type StaffSearchItem = { title: string; meta?: string; href: string };
/** `group` is the visible heading: Học viên · Lớp · Bài nộp · Đề (admin). */
export type StaffSearchGroup = { group: string; items: readonly StaffSearchItem[] };
export type StaffSearchFn = (query: string) => Promise<readonly StaffSearchGroup[]>;

const ROWS_PER_GROUP = 3;
/** Same floor as the backend (admin_search.MIN_QUERY = 2, which answers 422 below it). */
export const STAFF_SEARCH_MIN_QUERY = 2;
export const STAFF_SEARCH_PENDING = 'Đang tìm…';
export const STAFF_SEARCH_EMPTY = 'Không thấy kết quả. Thử tên, email hoặc mã khác.';
export const STAFF_SEARCH_FAILED = 'Chưa tìm được. Kiểm tra kết nối mạng rồi gõ lại.';

export type StaffQuickSearchProps = {
  search: StaffSearchFn;
  placeholder: string;
  /** Phone: the field is behind an icon button and opens as a strip under the bar. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/**
 * Quick search of the staff bar (UIBASE-0056 FR-010, KhungTrang2 §7):
 * ⌘K / Ctrl+K or a click focuses the field; results come grouped, at most
 * three rows a group; ↑ ↓ choose, Enter opens, Esc closes and clears. The data
 * comes from `search` (G09); a failed search says so instead of "no results".
 *
 * `search` runs on each change once the query has STAFF_SEARCH_MIN_QUERY
 * characters (shorter queries never call it, so no false "network" error);
 * debouncing, if wanted, belongs in G09's function. While a query is pending
 * the previous results are gone, so a click or Enter can never open a result
 * of an earlier query (the wrong learner).
 */
export function StaffQuickSearch({ search, placeholder, open, onOpenChange }: StaffQuickSearchProps) {
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<readonly StaffSearchGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [active, setActive] = useState(-1);
  const [mac, setMac] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const listId = useId();

  useEffect(() => { setMac(isMac()); }, []);

  const shown = (groups ?? [])
    .map((g) => ({ ...g, items: g.items.slice(0, ROWS_PER_GROUP) }))
    .filter((g) => g.items.length > 0);
  const flat = shown.flatMap((g) => g.items);
  const expanded = open && (groups !== null || failed || pending);

  const close = (blur: boolean) => {
    // A request still in flight must not refill the list after it closes.
    seq.current += 1;
    setQuery('');
    setGroups(null);
    setFailed(false);
    setPending(false);
    setActive(-1);
    onOpenChange(false);
    if (blur) input.current?.blur();
  };

  // ⌘K / Ctrl+K from anywhere on the page.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      event.preventDefault();
      onOpenChange(true);
      requestAnimationFrame(() => input.current?.focus());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onOpenChange]);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) closeRef.current(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const run = (value: string) => {
    setQuery(value);
    setActive(-1);
    setFailed(false);
    onOpenChange(true);
    // Drop the shown results at once: until the new answer arrives nothing is selectable.
    setGroups(null);
    const id = ++seq.current;
    const q = value.trim();
    if (q.length < STAFF_SEARCH_MIN_QUERY) { setPending(false); return; }
    setPending(true);
    search(q).then(
      (result) => { if (id === seq.current) { setPending(false); setGroups(result); } },
      () => { if (id === seq.current) { setPending(false); setFailed(true); } },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown': if (flat.length) setActive((i) => (i + 1) % flat.length); break;
      case 'ArrowUp': if (flat.length) setActive((i) => (i <= 0 ? flat.length - 1 : i - 1)); break;
      case 'Enter': {
        const item = flat[active] ?? (flat.length === 1 ? flat[0] : undefined);
        if (item) window.location.assign(item.href);
        break;
      }
      case 'Escape': close(true); break;
      default: return;
    }
    event.preventDefault();
  };

  const optionId = (i: number) => `${listId}-${i}`;
  let index = -1;

  return (
    <div ref={wrap} className={styles.search} data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className={styles.searchToggle}
        aria-label="Tìm nhanh"
        aria-expanded={open}
        onClick={() => (open ? close(false) : onOpenChange(true))}
      >
        <Icon name="search" />
      </button>
      <div className={styles.searchBox}>
        <label className={styles.searchField} data-active={open ? 'true' : undefined}>
          <Icon name="search" size={16} />
          <input
            ref={input}
            type="search"
            className={styles.searchInput}
            placeholder={placeholder}
            aria-label="Tìm nhanh"
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            value={query}
            onFocus={() => onOpenChange(true)}
            onChange={(event) => run(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className={styles.kbd} aria-hidden="true">{open ? 'Esc' : mac ? '⌘K' : 'Ctrl K'}</kbd>
        </label>
        {expanded ? (
          <div className={styles.searchPanel}>
            {pending ? <p className={styles.searchNote} role="status">{STAFF_SEARCH_PENDING}</p> : null}
            {failed ? <p className={styles.searchNote} role="alert">{STAFF_SEARCH_FAILED}</p> : null}
            {groups !== null ? (
              <div id={listId} role="listbox" aria-label="Kết quả tìm nhanh">
                {shown.length === 0 ? (
                  <p className={styles.searchNote} role="status">{STAFF_SEARCH_EMPTY}</p>
                ) : shown.map((group) => (
                  <div key={group.group} role="group" aria-label={group.group}>
                    <p className={styles.searchGroup} aria-hidden="true">{group.group}</p>
                    {group.items.map((item) => {
                      index += 1;
                      const i = index;
                      return (
                        <a
                          key={item.href}
                          id={optionId(i)}
                          role="option"
                          aria-selected={i === active}
                          href={item.href}
                          tabIndex={-1}
                          className={styles.searchItem}
                          onMouseEnter={() => setActive(i)}
                        >
                          <strong className={styles.searchTitle}>{item.title}</strong>
                          {item.meta ? <span className={styles.searchMeta}>{item.meta}</span> : null}
                        </a>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
            <p className={styles.searchHint} aria-hidden="true">↑ ↓ để chọn · Enter để mở · Esc để đóng</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
