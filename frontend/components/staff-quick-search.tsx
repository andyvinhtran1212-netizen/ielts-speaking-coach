'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import {
  STAFF_SEARCH_DEBOUNCE_MS,
  STAFF_SEARCH_MIN_QUERY,
  safeStaffHref,
  searchStaff,
  type StaffSearchDoor,
  type StaffSearchItem,
  type StaffSearchResult,
} from '@/lib/staff-search';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import styles from './staff-quick-search.module.css';

/**
 * Quick search of the staff consoles (ADMINIA-0074 FR-075, FR-102; G09-T19).
 *
 * Ctrl+K / ⌘K (outside a field), or any element that dispatches
 * `QUICK_SEARCH_OPEN_EVENT` on `window` (the "Tìm nhanh" button in
 * <aver-admin-chrome> and the teacher headers), opens a modal dialog. From two
 * characters, 250 ms after the last key, the query goes to
 * `POST /admin/search` or `POST /instructor/search` in the JSON body — never in
 * a URL, so no log keeps a learner's name. Groups come back with at most three
 * rows; empty groups are hidden. ↑ ↓ choose, Enter opens, Esc closes and gives
 * focus back. Nothing is stored between openings (no search history).
 */
export const QUICK_SEARCH_OPEN_EVENT = 'aver:quick-search-open';
export const MIN_QUERY = STAFF_SEARCH_MIN_QUERY;
export const DEBOUNCE_MS = STAFF_SEARCH_DEBOUNCE_MS;

export type QuickSearchDoor = StaffSearchDoor;
type Hit = StaffSearchItem;

export const SEARCH_HINT = 'Nhập ít nhất 2 ký tự để tìm.';
export const SEARCH_EMPTY = 'Không thấy kết quả. Thử tên, mã học viên hoặc tên lớp khác.';
export const SEARCH_FAILED = 'Chưa tìm được lúc này. Kiểm tra kết nối rồi gõ lại.';

const PLACEHOLDER: Record<QuickSearchDoor, string> = {
  admin: 'Tìm học viên, lớp, bài nộp, đề…',
  instructor: 'Tìm học viên, lớp, bài nộp của lớp mình…',
};

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function StaffQuickSearch({ door }: { door: QuickSearchDoor }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<StaffSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const listId = useId();
  const titleId = useId();

  const close = () => {
    // A request still in flight must not refill the next opening.
    seq.current += 1;
    window.clearTimeout(timer.current);
    setOpen(false);
    setQuery('');
    setResult(null);
    setLoading(false);
    setError(null);
    setActive(-1);
  };

  // Esc, the Tab trap, the scroll lock and focus return.
  useDialogFocus({ open, onClose: close, dialogRef: dialog, initialFocusRef: input });

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      // In a field the shortcut stays the browser's/field's (FR-075, T19).
      if (open || isTyping(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(QUICK_SEARCH_OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(QUICK_SEARCH_OPEN_EVENT, onOpen);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // `result` is cleared on every keystroke, so rows on screen (and what ↑ ↓
  // Enter can pick) always belong to the query in the field.
  const groups = result?.groups ?? [];
  const flat = groups.flatMap((g) => g.items);
  const failedLabels = result?.failed ?? [];

  const run = (value: string) => {
    const id = ++seq.current;
    searchStaff(door, value).then(
      (out) => {
        if (id !== seq.current) return;
        setResult(out);
        setLoading(false);
      },
      (err: { status?: number; message?: string }) => {
        if (id !== seq.current) return;
        setResult(null);
        setLoading(false);
        // A refusal is not an empty result: say what happened.
        setError(err?.status === 403 ? 'Tài khoản này không có quyền tìm ở đây.' : SEARCH_FAILED);
      },
    );
  };

  const onChange = (value: string) => {
    setQuery(value);
    setActive(-1);
    setError(null);
    window.clearTimeout(timer.current);
    seq.current += 1;
    // Drop the previous answer at once: a stale row must not be clickable or
    // reachable with Enter while the new query is pending.
    setResult(null);
    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY) {
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = window.setTimeout(() => run(trimmed), DEBOUNCE_MS);
  };

  const go = (hit: Hit | undefined) => {
    const href = hit ? safeStaffHref(hit.href) : null;
    if (!href) return;
    close();
    window.location.assign(href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown': if (flat.length) setActive((i) => (i + 1) % flat.length); break;
      case 'ArrowUp': if (flat.length) setActive((i) => (i <= 0 ? flat.length - 1 : i - 1)); break;
      case 'Enter': go(flat[active] ?? (flat.length === 1 ? flat[0] : undefined)); break;
      default: return;
    }
    event.preventDefault();
  };

  if (!open) return null;

  const optionId = (i: number) => `${listId}-${i}`;
  const short = query.trim().length < MIN_QUERY;
  let index = -1;

  return (
    <div className={styles.backdrop} onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div
        ref={dialog}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className={styles.srOnly}>Tìm nhanh</h2>
        <div className={styles.field}>
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={input}
            type="search"
            className={styles.input}
            placeholder={PLACEHOLDER[door]}
            aria-label="Tìm nhanh"
            role="combobox"
            aria-expanded={groups.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
            value={query}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className={styles.esc} onClick={close} aria-label="Đóng tìm nhanh">Esc</button>
        </div>

        <div className={styles.body}>
          {short ? <p className={styles.note}>{SEARCH_HINT}</p> : null}
          {!short && loading ? <p className={styles.note} role="status">Đang tìm…</p> : null}
          {!short && !loading && error ? <p className={styles.error} role="alert">{error}</p> : null}
          {!short && !loading && result && failedLabels.length > 0 ? (
            <p className={styles.error} role="alert">
              Chưa đọc được nhóm {failedLabels.join(', ')}. Kết quả có thể thiếu.
            </p>
          ) : null}
          {!short && !loading && result && groups.length === 0 && failedLabels.length === 0 ? (
            <p className={styles.note} role="status">{SEARCH_EMPTY}</p>
          ) : null}
          <div id={listId} role="listbox" aria-label="Kết quả tìm nhanh" className={styles.list} hidden={groups.length === 0}>
            {groups.map((group) => (
              <div key={group.group} role="group" aria-label={group.group}>
                <p className={styles.group} aria-hidden="true">{group.group}</p>
                {group.items.map((hit) => {
                  index += 1;
                  const i = index;
                  return (
                    <a
                      key={`${group.group}-${i}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active}
                      href={hit.href}
                      tabIndex={-1}
                      className={styles.item}
                      onMouseEnter={() => setActive(i)}
                      onClick={(event) => { event.preventDefault(); go(hit); }}
                    >
                      <span className={styles.title}>{hit.title}</span>
                      {hit.meta ? <span className={styles.meta}>{hit.meta}</span> : null}
                    </a>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <p className={styles.footer} aria-hidden="true">↑ ↓ để chọn · Enter để mở · Esc để đóng</p>
      </div>
    </div>
  );
}

/** Opens the palette from a header (teacher pages render their own header). */
export function QuickSearchButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={`${styles.trigger} ${className ?? ''}`.trim()}
      onClick={() => window.dispatchEvent(new CustomEvent(QUICK_SEARCH_OPEN_EVENT))}
      aria-label="Tìm nhanh (Ctrl K)"
      aria-haspopup="dialog"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <span className={styles.triggerLabel}>Tìm nhanh</span>
      <kbd className={styles.kbd}>⌘K</kbd>
    </button>
  );
}
