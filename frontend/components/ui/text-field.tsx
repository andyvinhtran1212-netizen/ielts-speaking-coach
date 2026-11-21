'use client';

import { useId, type ChangeEvent, type InputHTMLAttributes } from 'react';

import styles from './field.module.css';
import { cx } from './cx';

export type TextFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'style' | 'className' | 'onChange' | 'readOnly' | 'type' | 'aria-invalid' | 'aria-describedby'
> & {
  label: string;
  /** Help under the field. The placeholder is only an example, never the label. */
  hint?: string;
  /** Says how to fix it, e.g. "Mã không đúng hoặc đã hết hạn." Replaces the hint. */
  error?: string;
  /** Read-only, with the reason shown under the field. */
  readOnlyReason?: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'password' | 'number';
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
  className?: string;
};

/** Single-line text field (UIBASE-0056 FR-005, ThanhPhan §2). */
export function TextField({ label, hint, error, readOnlyReason, type = 'text', id, onChange, className, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? `tf-${autoId}`;
  const noteId = `${inputId}-note`;
  const note = error ?? readOnlyReason ?? hint;
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={inputId} className={cx(styles.label, readOnlyReason && styles.labelMuted)}>{label}</label>
      <input
        {...rest}
        id={inputId}
        type={type}
        readOnly={readOnlyReason ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        className={styles.control}
        onChange={onChange ? (event) => onChange(event.target.value, event) : undefined}
      />
      {note ? <span id={noteId} className={error ? styles.error : styles.hint}>{note}</span> : null}
    </div>
  );
}
