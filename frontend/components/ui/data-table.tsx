'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import styles from './data-table.module.css';
import { cx } from './cx';

export type DataTableAlign = 'start' | 'end';

export type DataTableColumn<Row> = {
  key: string;
  label: string;
  /** `end` for numbers: right-aligned, same-width digits. */
  align?: DataTableAlign;
  sortable?: boolean;
  /** Cell content; defaults to `row[key]`. `null`, `undefined` or `''` prints "chưa có". */
  render?: (row: Row) => ReactNode;
  /** e.g. `en` for skill names, so screen readers switch voice. */
  lang?: string;
};

export type DataTableSortDirection = 'ascending' | 'descending';
export type DataTableSort = { key: string; direction: DataTableSortDirection } | null;

/** `key` defaults to `label`; pass one when two filters can share a label. */
export type DataTableFilter = { key?: string; label: string; onRemove: () => void };

export type DataTableProps<Row> = {
  /** Says what the table lists and how it is sorted. Visible unless `captionHidden`. */
  caption: string;
  captionHidden?: boolean;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Key of the column that names the row (a `<th scope="row">`); defaults to the first column. */
  rowHeader?: string;
  /** 52px rows (learner, instructor) or 40px rows with 14px text (admin, many records). */
  density?: 'comfortable' | 'dense';
  /**
   * The first column (and the select column before it) stays put while the
   * table scrolls sideways: the 1024px admin rule (FR-018) and the phone box.
   * It is `columns[0]` whatever `rowHeader` names; keep the name column first.
   */
  stickyFirstColumn?: boolean;

  /** Multi-select: a checkbox per row and a three-state one in the header. */
  selectable?: boolean;
  selected?: readonly string[];
  onSelectedChange?: (keys: string[]) => void;
  /** Name in "Chọn {name}"; defaults to the row header's text value. */
  rowLabel?: (row: Row) => string;
  /** Buttons of the action bar shown while rows are selected. Dangerous ones go in `bulkDanger`. */
  bulkActions?: ReactNode;
  /** Right side of the action bar, e.g. "Khoá quyền học…" (it asks again). */
  bulkDanger?: ReactNode;
  /** "Đã chọn 2 học viên". */
  selectionLabel?: (count: number) => string;
  /** Accessible name of the action bar. */
  bulkLabel?: string;
  /** Line in place of the bar while nothing is selected. */
  selectionHint?: string;

  /** Controlled sort; the parent sorts `rows` (see `sortRows`). */
  sort?: DataTableSort;
  onSort?: (next: DataTableSort) => void;

  /** Applied filters as chips, each removable; `onClearFilters` adds "Xoá bộ lọc". */
  filters?: readonly DataTableFilter[];
  onClearFilters?: () => void;
  /** "6 học viên" at the right of the filter line, announced politely. */
  resultLabel?: ReactNode;

  /** Per-row actions, in a column pinned to the right ("Hành động"). */
  actions?: (row: Row) => ReactNode;

  /** Shown in place of the rows when there are none: a title, a line, one action. */
  emptyState: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
};

const MISSING = 'chưa có';
const SORT_WORD: Record<DataTableSortDirection, string> = { ascending: 'tăng', descending: 'giảm' };
const SKELETON_ROWS = 4;

/** Header click cycle (ThanhPhanDuLieu §1): ascending, then descending, then no sort. */
export function nextSort(sort: DataTableSort, key: string): DataTableSort {
  if (!sort || sort.key !== key) return { key, direction: 'ascending' };
  return sort.direction === 'ascending' ? { key, direction: 'descending' } : null;
}

function isMissing(value: unknown) {
  return value === null || value === undefined || value === '';
}

const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

/**
 * Sorts a copy of `rows` the way the sheet asks: empty values always last,
 * whatever the direction; numbers by value; text by Vietnamese collation.
 * `valueOf` picks the sort value, e.g. a learner's given name ("Hằng" for
 * "Nguyễn Thị Hằng").
 */
export function sortRows<Row>(rows: readonly Row[], sort: DataTableSort, valueOf: (row: Row, key: string) => unknown): Row[] {
  const copy = [...rows];
  if (!sort) return copy;
  const sign = sort.direction === 'ascending' ? 1 : -1;
  return copy.sort((a, b) => {
    const x = valueOf(a, sort.key);
    const y = valueOf(b, sort.key);
    if (isMissing(x) || isMissing(y)) return Number(isMissing(x)) - Number(isMissing(y));
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return collator.compare(String(x), String(y)) * sign;
  });
}

/** Given name for sorting: the last word of a Vietnamese full name. */
export function givenName(fullName: string) {
  const words = fullName.trim().split(/\s+/);
  return `${words[words.length - 1] ?? ''} ${fullName}`;
}

/** The empty row's content as the sheet draws it: a title, a line, one next step. */
export function DataTableEmpty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <>
      <p className={styles.emptyTitle}>{title}</p>
      {body ? <p className={styles.emptyBody}>{body}</p> : null}
      {action}
    </>
  );
}

function SortIcon({ direction }: { direction: DataTableSortDirection | null }) {
  const d = direction === 'ascending' ? 'M6 12V2M2.5 5.5L6 2l3.5 3.5'
    : direction === 'descending' ? 'M6 2v10M2.5 8.5L6 12l3.5-3.5'
      : 'M3 5l3-3 3 3M3 9l3 3 3-3';
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true" className={cx(!direction && styles.sortIdle)}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Checkbox({ checked, mixed = false, label, onChange }: { checked: boolean; mixed?: boolean; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return (
    <label className={styles.check}>
      <input ref={ref} type="checkbox" className={styles.checkInput} aria-label={label} checked={checked} onChange={onChange} />
    </label>
  );
}

function cellValue<Row>(row: Row, column: DataTableColumn<Row>): ReactNode {
  const value = column.render ? column.render(row) : (row as Record<string, unknown>)[column.key];
  if (isMissing(value)) return <span className={styles.missing}>{MISSING}</span>;
  return value as ReactNode;
}

function textOf<Row>(row: Row, key: string) {
  const value = (row as Record<string, unknown>)[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * Data table of the "Bản in" UI (UIBASE-0056 FR-005, FR-018, ThanhPhanDuLieu
 * §1–2). A real `<table>` with a caption; sortable headers carry `aria-sort`
 * and say the direction in words; numbers are right-aligned with same-width
 * digits; an empty cell says "chưa có". Selection shows an action bar with
 * the count; the header checkbox has three states. The table scrolls inside
 * its own frame, never the page: the actions column is pinned right and,
 * with `stickyFirstColumn`, the first column is pinned left.
 *
 * Controlled: the parent owns `sort`, `selected` and filters, and fetches or
 * sorts the rows (`nextSort`, `sortRows` follow the sheet's rules).
 */
export function DataTable<Row>({
  caption, captionHidden = false, columns, rows, rowKey, rowHeader, density = 'comfortable', stickyFirstColumn = false,
  selectable = false, selected = [], onSelectedChange, rowLabel, bulkActions, bulkDanger,
  selectionLabel = (n) => `Đã chọn ${n} mục`, bulkLabel = 'Hành động cho các mục đã chọn',
  selectionHint = 'Chưa chọn mục nào. Đánh dấu ô ở đầu hàng để hiện thanh hành động hàng loạt.',
  sort = null, onSort, filters, onClearFilters, resultLabel, actions, emptyState, loading = false,
  loadingLabel = 'Đang tải…', className,
}: DataTableProps<Row>) {
  const headerKey = rowHeader ?? columns[0]?.key;
  const pinnedKey = stickyFirstColumn ? columns[0]?.key : undefined;
  const keys = rows.map(rowKey);
  const chosen = new Set(selected);
  const chosenHere = keys.filter((k) => chosen.has(k));
  const all = keys.length > 0 && chosenHere.length === keys.length;
  const some = chosenHere.length > 0 && !all;
  const span = columns.length + (selectable ? 1 : 0) + (actions ? 1 : 0);
  const showRows = !loading && rows.length > 0;

  const toggleAll = () => {
    if (!onSelectedChange) return;
    const here = new Set(keys);
    onSelectedChange(all ? selected.filter((k) => !here.has(k)) : [...selected, ...keys.filter((k) => !chosen.has(k))]);
  };
  const toggle = (key: string) => {
    if (!onSelectedChange) return;
    onSelectedChange(chosen.has(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };

  const hasFilterLine = filters !== undefined || resultLabel !== undefined;

  return (
    <div className={cx(styles.wrap, density === 'dense' && styles.dense, stickyFirstColumn && styles.sticky, className)}>
      {hasFilterLine ? (
        <div className={styles.filterLine}>
          {filters ? (
            <>
              <span className={styles.filterWord}>Đang lọc:</span>
              {filters.length === 0 ? <span className={styles.filterNone}>chưa có bộ lọc nào.</span> : null}
              {filters.map((f) => (
                <span key={f.key ?? f.label} className={styles.chip}>
                  {f.label}
                  <button type="button" className={styles.chipRemove} aria-label={`Bỏ lọc ${f.label}`} onClick={f.onRemove}>
                    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.75" /></svg>
                  </button>
                </span>
              ))}
              {filters.length > 0 && onClearFilters ? (
                <button type="button" className={styles.textButton} onClick={onClearFilters}>Xoá bộ lọc</button>
              ) : null}
            </>
          ) : null}
          {resultLabel !== undefined ? <span role="status" className={styles.result}>{resultLabel}</span> : null}
        </div>
      ) : null}

      {selectable ? (
        <div className={styles.barSlot}>
          {chosen.size > 0 ? (
            <div role="region" aria-label={bulkLabel} className={styles.bar}>
              <strong className={styles.barCount}>{selectionLabel(chosen.size)}</strong>
              {bulkActions ? <span className={styles.barRule} aria-hidden="true" /> : null}
              {bulkActions}
              <span className={styles.barEnd}>
                {bulkDanger}
                <button type="button" className={styles.textButton} onClick={() => onSelectedChange?.([])}>Bỏ chọn</button>
              </span>
            </div>
          ) : (
            <p className={styles.barHint}>{selectionHint}</p>
          )}
        </div>
      ) : null}

      <div className={styles.frame} role="region" aria-label={caption} tabIndex={0}>
        <table className={styles.table} aria-busy={loading || undefined}>
          <caption className={cx(styles.caption, captionHidden && styles.visuallyHidden)}>{caption}</caption>
          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className={cx(styles.selectCell, styles.head)}>
                  <Checkbox checked={all} mixed={some} label="Chọn cả trang" onChange={toggleAll} />
                </th>
              ) : null}
              {columns.map((column) => {
                const direction = sort?.key === column.key ? sort.direction : null;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={column.sortable ? (direction ?? 'none') : undefined}
                    className={cx(
                      styles.head,
                      column.align === 'end' && styles.end,
                      column.key === pinnedKey && styles.pinned,
                      column.sortable && styles.sortable,
                    )}
                  >
                    {column.sortable && onSort ? (
                      <button type="button" className={styles.sortButton} onClick={() => onSort(nextSort(sort, column.key))}>
                        {column.label}
                        {direction ? <span className={styles.sortWord}>{SORT_WORD[direction]}</span> : null}
                        <SortIcon direction={direction} />
                      </button>
                    ) : column.label}
                  </th>
                );
              })}
              {actions ? <th scope="col" className={cx(styles.head, styles.actionsCell)}>Hành động</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <tr key={`skeleton-${i}`} aria-hidden="true">
                {Array.from({ length: span }, (_, j) => (
                  <td key={j} className={styles.cell}><span className={cx(styles.skeleton, styles[`skeleton${(i + j) % 3}`])} /></td>
                ))}
              </tr>
            )) : null}
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={span} className={styles.empty}>{emptyState}</td></tr>
            ) : null}
            {showRows ? rows.map((row) => {
              const key = rowKey(row);
              const isChosen = chosen.has(key);
              const name = rowLabel ? rowLabel(row) : textOf(row, headerKey ?? '');
              return (
                <tr key={key} className={cx(styles.row, isChosen && styles.chosen)}>
                  {selectable ? (
                    <td className={cx(styles.cell, styles.selectCell)}>
                      <Checkbox checked={isChosen} label={`Chọn ${name}`} onChange={() => toggle(key)} />
                    </td>
                  ) : null}
                  {columns.map((column) => {
                    const cls = cx(styles.cell, column.align === 'end' && styles.end, column.key === pinnedKey && styles.pinned);
                    return column.key === headerKey ? (
                      <th key={column.key} scope="row" lang={column.lang} className={cx(cls, styles.rowName)}>{cellValue(row, column)}</th>
                    ) : (
                      <td key={column.key} lang={column.lang} className={cls}>{cellValue(row, column)}</td>
                    );
                  })}
                  {actions ? <td className={cx(styles.cell, styles.actionsCell)}><span className={styles.actions}>{actions(row)}</span></td> : null}
                </tr>
              );
            }) : null}
          </tbody>
        </table>
      </div>
      {loading ? <p role="status" className={styles.loadingNote}>{loadingLabel}</p> : null}
    </div>
  );
}
