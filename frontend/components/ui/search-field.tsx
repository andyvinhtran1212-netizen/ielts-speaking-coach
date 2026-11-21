'use client';

import { useId, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';

import fieldStyles from './field.module.css';
import { IconButton } from './icon-button';
import styles from './search-field.module.css';
import { cx } from './cx';

export type SearchFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'style' | 'className' | 'type' | 'value' | 'onChange' | 'defaultValue'
> & {
  /** Hidden on screen, still read by screen readers; also names the search landmark. */
  label: string;
  /** Called with the query on Enter, and with '' after "Xoá nội dung tìm". */
  onSearch?: (query: string) => void;
  defaultValue?: string;
  /** Accessible name of the clear button. */
  clearLabel?: string;
  className?: string;
};

/** Search box with a clear button once it has text (UIBASE-0056 FR-005, ThanhPhan §2). */
export function SearchField({
  label, onSearch, defaultValue = '', clearLabel = 'Xoá nội dung tìm', id, className, ...rest
}: SearchFieldProps) {
  const autoId = useId();
  const inputId = id ?? `sf-${autoId}`;
  const labelId = `${inputId}-label`;
  const [query, setQuery] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch?.(query.trim());
  }

  function clear() {
    setQuery('');
    inputRef.current?.focus();
    onSearch?.('');
  }

  return (
    <form role="search" aria-labelledby={labelId} className={cx(fieldStyles.field, className)} onSubmit={submit}>
      <label id={labelId} htmlFor={inputId} className={fieldStyles.visuallyHidden}>{label}</label>
      <span className={styles.wrap}>
        <input
          {...rest}
          ref={inputRef}
          id={inputId}
          type="search"
          value={query}
          className={cx(fieldStyles.control, styles.input)}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? <IconButton icon="close" label={clearLabel} size="sm" className={styles.clear} onClick={clear} /> : null}
      </span>
    </form>
  );
}
