'use client';

import { useId, useRef } from 'react';

import styles from './choice-group.module.css';
import { cx } from './cx';

export type ChoiceOption = { value: string; label: string; disabled?: boolean };

type Common = {
  legend: string;
  options: readonly ChoiceOption[];
  /** Form field name; generated when omitted. */
  name?: string;
  hint?: string;
  error?: string;
  className?: string;
};

export type ChoiceGroupProps =
  | (Common & {
      mode: 'single';
      value?: string;
      defaultValue?: string;
      onChange?: (value: string) => void;
    })
  | (Common & {
      mode: 'multiple';
      value?: readonly string[];
      defaultValue?: readonly string[];
      onChange?: (value: string[]) => void;
    });

/** Native radios or checkboxes in a `<fieldset>` (UIBASE-0056 FR-005, ThanhPhan §2). */
export function ChoiceGroup(props: ChoiceGroupProps) {
  const { legend, options, hint, error, className } = props;
  const autoId = useId();
  const name = props.name ?? `cg-${autoId}`;
  const noteId = `${name}-note`;
  const note = error ?? hint;
  const ref = useRef<HTMLFieldSetElement>(null);
  const type = props.mode === 'single' ? 'radio' : 'checkbox';
  const selected = (v: string, source: string | readonly string[] | undefined) =>
    Array.isArray(source) ? source.includes(v) : source === v;

  function handleChange(changed: string) {
    if (props.mode === 'single') {
      props.onChange?.(changed);
      return;
    }
    const elements = ref.current ? [...ref.current.elements] : [];
    props.onChange?.(
      elements
        .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.name === name && el.checked)
        .map((el) => el.value),
    );
  }

  return (
    <fieldset
      ref={ref}
      className={cx(styles.group, className)}
      aria-describedby={note ? noteId : undefined}
    >
      <legend className={styles.legend}>{legend}</legend>
      {options.map((option) => {
        const checkedProps = props.value !== undefined
          ? { checked: selected(option.value, props.value) }
          : { defaultChecked: selected(option.value, props.defaultValue) };
        return (
          <label key={option.value} className={cx(styles.option, option.disabled && styles.disabled)}>
            <input
              type={type}
              name={name}
              value={option.value}
              disabled={option.disabled}
              className={styles.input}
              onChange={() => handleChange(option.value)}
              {...checkedProps}
            />
            <span>{option.label}</span>
          </label>
        );
      })}
      {note ? <span id={noteId} className={error ? styles.error : styles.hint}>{note}</span> : null}
    </fieldset>
  );
}
