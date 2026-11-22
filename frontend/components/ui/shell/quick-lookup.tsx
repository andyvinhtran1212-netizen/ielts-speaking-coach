'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { IconButton } from '../icon-button';
import { useLearnerShellPanel } from './learner-panel';
import styles from './learner-shell.module.css';

export type LookupGroupId = 'vocabulary' | 'grammar' | 'writing';
export type LookupItem = { title: string; meta?: string; href: string };
export type LookupGroup = { group: LookupGroupId; items: readonly LookupItem[] };
export type LookupFn = (query: string) => Promise<readonly LookupGroup[]>;

const GROUPS: readonly { id: LookupGroupId; label: string }[] = [
  { id: 'vocabulary', label: 'Từ · Từ vựng' },
  { id: 'grammar', label: 'Bài ngữ pháp · Grammar Wiki' },
  { id: 'writing', label: 'Đề bài mẫu · Writing' },
];
const ROWS_PER_GROUP = 2;
export const LOOKUP_EMPTY = 'Không thấy kết quả. Thử từ khác hoặc vào Thư viện.';

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Quick lookup of the learner bar (UIBASE-0056 FR-017, KhungTrang §1): the
 * magnifier or the `/` key (outside a field) opens a field with focus in it.
 * Suggestions in three groups, at most 2 rows each; arrows choose, Enter opens,
 * Esc closes and returns focus to the button. From 768px only (CSS); the data
 * comes from `lookup`, wired by G06.
 */
export function QuickLookup({ lookup }: { lookup: LookupFn }) {
  const [open, setOpen] = useLearnerShellPanel('lookup');
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<readonly LookupGroup[] | null>(null);
  const [active, setActive] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const listId = useId();

  const shown = (groups ?? [])
    .map((g) => ({ ...g, items: g.items.slice(0, ROWS_PER_GROUP) }))
    .filter((g) => g.items.length > 0)
    .sort((a, b) => GROUPS.findIndex((x) => x.id === a.group) - GROUPS.findIndex((x) => x.id === b.group));
  const flat = shown.flatMap((g) => g.items);

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    setGroups(null);
    setActive(-1);
    if (refocus) wrap.current?.querySelector<HTMLButtonElement>('[data-lookup-trigger]')?.focus();
  };

  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  // `/` opens the lookup when focus is not in a field and the button is on screen.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      // Below 768px the whole control is display:none (no lookup on the phone bar).
      if (!wrap.current || getComputedStyle(wrap.current).display === 'none') return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const search = (value: string) => {
    setQuery(value);
    setActive(-1);
    const id = ++seq.current;
    if (!value.trim()) { setGroups(null); return; }
    lookup(value.trim()).then(
      (result) => { if (id === seq.current) setGroups(result); },
      () => { if (id === seq.current) setGroups([]); },
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
    <div ref={wrap} className={styles.lookup}>
      <IconButton
        icon="search"
        label="Tra nhanh (phím /)"
        data-lookup-trigger=""
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
      />
      {open ? (
        <div className={styles.lookupPanel}>
          <input
            ref={input}
            type="search"
            className={styles.lookupInput}
            placeholder="Tra từ, bài ngữ pháp, đề bài mẫu"
            aria-label="Tra nhanh"
            role="combobox"
            aria-expanded={groups !== null}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            value={query}
            onChange={(event) => search(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {groups !== null ? (
            <div id={listId} role="listbox" aria-label="Gợi ý" className={styles.lookupList}>
              {shown.length === 0 ? (
                <p className={styles.lookupEmpty} role="status">{LOOKUP_EMPTY}</p>
              ) : shown.map((group) => (
                <div key={group.group} role="group" aria-label={GROUPS.find((g) => g.id === group.group)?.label}>
                  <p className={styles.lookupGroup} aria-hidden="true">{GROUPS.find((g) => g.id === group.group)?.label}</p>
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
                        className={styles.lookupItem}
                        onMouseEnter={() => setActive(i)}
                      >
                        <span className={styles.lookupTitle}>{item.title}</span>
                        {item.meta ? <span className={styles.lookupMeta}>{item.meta}</span> : null}
                      </a>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
