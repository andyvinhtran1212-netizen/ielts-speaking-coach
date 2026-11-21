'use client';

import { useId, type ChangeEvent, type SelectHTMLAttributes } from 'react';

import styles from './field.module.css';
import { cx } from './cx';

export type SelectOption = { value: string; label: string };

export type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'style' | 'className' | 'onChange' | 'children' | 'multiple' | 'aria-invalid' | 'aria-describedby'
> & {
  label: string;
  options: readonly SelectOption[];
  hint?: string;
  error?: string;
  onChange?: (value: string, event: ChangeEvent<HTMLSelectElement>) => void;
  className?: string;
};

/** Native `<select>`, restyled (UIBASE-0056 FR-005, ThanhPhan §2). */
export function Select({ label, options, hint, error, id, onChange, className, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? `sel-${autoId}`;
  const noteId = `${selectId}-note`;
  const note = error ?? hint;
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={selectId} className={styles.label}>{label}</label>
      <select
        {...rest}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        className={styles.control}
        onChange={onChange ? (event) => onChange(event.target.value, event) : undefined}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {note ? <span id={noteId} className={error ? styles.error : styles.hint}>{note}</span> : null}
    </div>
  );
}
