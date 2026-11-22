import type { ReactNode } from 'react';

import { Icon } from './icon/icon';
import type { IconName } from './icon/icon-set';
import styles from './notice.module.css';
import { cx } from './cx';

export type NoticeKind = 'info' | 'success' | 'warning' | 'error';

export type NoticeProps = {
  kind?: NoticeKind;
  /** Bold lead-in, e.g. "Đã lưu bản nháp." */
  title?: string;
  children?: ReactNode;
  /** A link or button after the text, e.g. "Thử nộp lại". */
  action?: ReactNode;
  /** `en` inside the exam room: the word label becomes "Warning" / "Error". */
  lang?: 'vi' | 'en';
  /**
   * Live region. Default: `status` for info/success, `alert` for warning/error.
   * Pass `none` for a notice that is part of the page from the first render.
   */
  live?: 'status' | 'alert' | 'none';
  className?: string;
};

const LABELS = {
  vi: { warning: 'Cảnh báo', error: 'Lỗi' },
  en: { warning: 'Warning', error: 'Error' },
} as const;

const ICONS: Partial<Record<NoticeKind, IconName>> = { warning: 'warning', error: 'error' };

/**
 * Inline message of the "Bản in" UI (UIBASE-0056 FR-005, ThanhPhan §4).
 * Warning and error never rely on colour alone: thick left rule, tinted
 * background, triangle/circle icon and the word "Cảnh báo"/"Lỗi".
 */
export function Notice({ kind = 'info', title, children, action, lang = 'vi', live, className }: NoticeProps) {
  const strong = kind === 'warning' || kind === 'error';
  const role = live ?? (strong ? 'alert' : 'status');
  const icon = ICONS[kind];
  return (
    <div
      role={role === 'none' ? undefined : role}
      lang={lang === 'en' ? 'en' : undefined}
      className={cx(styles.notice, styles[kind], className)}
    >
      {icon ? <Icon name={icon} className={styles.icon} /> : null}
      <p className={styles.body}>
        {strong ? <span className={styles.label}>{LABELS[lang][kind as 'warning' | 'error']}</span> : null}
        {title ? <strong className={styles.title}>{title}</strong> : null}
        {title && children ? ' ' : null}
        {children}
        {action ? <> <span className={styles.action}>{action}</span></> : null}
      </p>
    </div>
  );
}
