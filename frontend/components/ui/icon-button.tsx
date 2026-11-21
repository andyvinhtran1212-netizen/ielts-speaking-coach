'use client';

import type { ButtonHTMLAttributes } from 'react';

import { Icon } from './icon/icon';
import type { IconName } from './icon/icon-set';
import styles from './icon-button.module.css';
import { cx } from './cx';

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'style' | 'className' | 'children' | 'aria-label'
> & {
  icon: IconName;
  /** Required: becomes the accessible name (`aria-label`) and the tooltip. */
  label: string;
  /** 48 / 44 / 36 px square. */
  size?: 'lg' | 'md' | 'sm';
  /** `plain`: no border (toolbars, inside a field). `outline`: 1px ink border. */
  variant?: 'plain' | 'outline';
  className?: string;
};

const SIZE = { lg: styles.lg, md: styles.md, sm: styles.sm } as const;

/** Icon-only button (UIBASE-0056 FR-005, ThanhPhan §1): always has a spoken name. */
export function IconButton({ icon, label, size = 'md', variant = 'plain', type = 'button', className, ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={rest.title ?? label}
      className={cx(styles.button, SIZE[size], variant === 'outline' && styles.outline, className)}
    >
      <Icon name={icon} size={size === 'lg' ? 24 : 20} />
    </button>
  );
}
