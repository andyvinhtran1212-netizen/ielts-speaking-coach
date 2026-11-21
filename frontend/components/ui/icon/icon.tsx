import { ICON_SET, type IconName, type IconShape } from './icon-set';
import styles from './icon.module.css';
import { cx } from '../cx';

export type IconProps = {
  name: IconName;
  /** 16 | 20 | 22 | 24 px. Default 20. */
  size?: 16 | 20 | 22 | 24;
  /** Without a title the icon is decorative (`aria-hidden`). */
  title?: string;
  className?: string;
};

const SIZE_CLASS = { 16: styles.s16, 20: styles.s20, 22: styles.s22, 24: styles.s24 } as const;

/** One 24-grid, 2px-stroke icon from the shared set (FR-006). */
export function Icon({ name, size = 20, title, className }: IconProps) {
  const shape: IconShape = ICON_SET[name];
  const a11y = title ? { role: 'img' as const } : { 'aria-hidden': true as const };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={cx(styles.icon, SIZE_CLASS[size], className)}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {shape.paths.map((d) => <path key={d} d={d} />)}
      {shape.circles?.map(([cx_, cy, r]) => <circle key={`${cx_}-${cy}-${r}`} cx={cx_} cy={cy} r={r} />)}
    </svg>
  );
}
