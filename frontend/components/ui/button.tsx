'use client';

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';

import styles from './button.module.css';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';
export type ButtonSize = 'lg' | 'md' | 'sm';

type CommonProps = {
  /**
   * `primary`: one per screen. `secondary`: other actions. `text`: minor actions
   * (no loading state). `danger`: only inside `ConfirmDialog` or a warning
   * `Notice`, because a destructive action always asks again (ThanhPhan §1).
   */
  variant?: ButtonVariant;
  /** 48 / 44 / 36 px: phone, default, admin tables. */
  size?: ButtonSize;
  /**
   * Busy: `aria-disabled`, clicks ignored, label swapped. Passing `loading`
   * (even `false`) or `loadingLabel` reserves the wider of the two labels, so
   * the width does not jump when it turns busy; buttons that never load pass
   * neither and keep their own width.
   */
  loading?: boolean;
  /** Label while busy, e.g. "Đang nộp…". Defaults to "Đang xử lý…". */
  loadingLabel?: string;
  disabled?: boolean;
  /** Decorative icon before the label (pass an `<Icon>`). */
  iconStart?: ReactNode;
  className?: string;
  children: ReactNode;
};

type AsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className' | 'children' | 'disabled'> & {
    href?: undefined;
    /** React 19 ref-as-prop, e.g. the initial focus of a dialog. */
    ref?: Ref<HTMLButtonElement>;
  };

type AsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'style' | 'className' | 'children' | 'href'> & {
    /** Renders an `<a>`: navigation, not an action. */
    href: string;
  };

export type ButtonProps = AsButton | AsLink;

const VARIANT = { primary: styles.primary, secondary: styles.secondary, text: styles.text, danger: styles.danger } as const;
const SIZE = { lg: styles.lg, md: styles.md, sm: styles.sm } as const;

/** Button of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhan §1). */
export function Button(props: ButtonProps) {
  const {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel = 'Đang xử lý…',
    disabled = false,
    iconStart,
    className,
    children,
    ...rest
  } = props;
  const canBusy = variant !== 'text' && (props.loading !== undefined || props.loadingLabel !== undefined);
  const busy = canBusy && loading;
  const classes = cx(styles.button, VARIANT[variant], SIZE[size], className);
  const content = (
    <span className={styles.stack}>
      <span className={cx(styles.label, busy && styles.hidden)} aria-hidden={busy || undefined}>
        {iconStart ? <span className={styles.icon} aria-hidden="true">{iconStart}</span> : null}
        {children}
      </span>
      {/* In the grid whenever it can turn busy, so the wider label sets the width in both states. */}
      {canBusy ? (
        <span className={cx(styles.label, !busy && styles.hidden)} aria-hidden={!busy || undefined}>
          {loadingLabel}
        </span>
      ) : null}
    </span>
  );

  if (rest.href !== undefined) {
    const { href, onClick, ...anchorRest } = rest as Omit<AsLink, keyof CommonProps>;
    const inert = disabled || busy;
    return (
      <a
        {...anchorRest}
        href={inert ? undefined : href}
        role={inert ? 'link' : undefined}
        aria-disabled={inert || undefined}
        aria-busy={busy || undefined}
        className={classes}
        onClick={inert ? (event: MouseEvent<HTMLAnchorElement>) => event.preventDefault() : onClick}
      >
        {content}
      </a>
    );
  }

  const { type = 'button', onClick, ...buttonRest } = rest as Omit<AsButton, keyof CommonProps>;
  return (
    <button
      {...buttonRest}
      type={type}
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      className={classes}
      onClick={busy ? (event: MouseEvent<HTMLButtonElement>) => event.preventDefault() : onClick}
    >
      {content}
    </button>
  );
}
