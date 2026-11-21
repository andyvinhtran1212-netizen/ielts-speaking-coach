'use client';

import { useId, type ChangeEvent, type TextareaHTMLAttributes } from 'react';

import fieldStyles from './field.module.css';
import styles from './text-area.module.css';
import { cx } from './cx';

export type TextAreaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'style' | 'className' | 'onChange' | 'readOnly' | 'aria-invalid' | 'aria-describedby'
> & {
  label: string;
  hint?: string;
  error?: string;
  readOnlyReason?: string;
  /** Autosave line, e.g. "Đã lưu lúc 10:42". The page formats the time. */
  saveStatus?: string;
  /** Shown as "count / limit từ". The page counts, so it uses the grader's rule. */
  wordCount?: { count: number; limit: number };
  onChange?: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
};

/** Long text, e.g. a Writing answer (UIBASE-0056 FR-005, ThanhPhan §2). */
export function TextArea({
  label, hint, error, readOnlyReason, saveStatus, wordCount, id, rows = 4, onChange, className, ...rest
}: TextAreaProps) {
  const autoId = useId();
  const areaId = id ?? `ta-${autoId}`;
  const noteId = `${areaId}-note`;
  const metaId = `${areaId}-meta`;
  const note = error ?? readOnlyReason ?? hint;
  const hasMeta = Boolean(saveStatus) || Boolean(wordCount);
  const describedBy = [note ? noteId : null, hasMeta ? metaId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx(fieldStyles.field, className)}>
      <label htmlFor={areaId} className={cx(fieldStyles.label, readOnlyReason && fieldStyles.labelMuted)}>{label}</label>
      <textarea
        {...rest}
        id={areaId}
        rows={rows}
        readOnly={readOnlyReason ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(fieldStyles.control, styles.area)}
        onChange={onChange ? (event) => onChange(event.target.value, event) : undefined}
      />
      {note ? <span id={noteId} className={error ? fieldStyles.error : fieldStyles.hint}>{note}</span> : null}
      {hasMeta ? (
        <span id={metaId} className={styles.meta}>
          <span>{saveStatus}</span>
          {wordCount ? <span className={styles.count}>{wordCount.count} / {wordCount.limit} từ</span> : null}
        </span>
      ) : null}
    </div>
  );
}
