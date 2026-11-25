import type { ReactNode } from 'react';

import { Breadcrumb } from '@/components/ui';
import { PublicShell } from '@/components/ui/shell/public-shell';

import styles from './legal.module.css';

/**
 * Shared head of the four public pages (G02-T13, PhapLy.dc.html): the public
 * shell, "Trang chủ › {title}", the title, an optional lead, and the "Bản tạm"
 * note that stays until legal sign-off.
 */
export function LegalPage({ title, lead, meta, aside, children }: {
  title: string;
  lead?: ReactNode;
  /** Line under the title, e.g. the effective and updated dates. */
  meta?: ReactNode;
  /** Right-hand illustration next to the title (Giới thiệu). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PublicShell>
      <Breadcrumb items={[{ label: 'Trang chủ', href: '/' }, { label: title }]} className={styles.crumbs} />
      <div className={styles.column}>
        <div className={aside ? styles.headWithAside : undefined}>
          <div>
            <h1 className={styles.title}>{title}</h1>
            {meta ? <p className={styles.meta}>{meta}</p> : null}
            {lead ? <p className={styles.lead}>{lead}</p> : null}
          </div>
          {aside}
        </div>
        <p className={styles.draft} role="note">
          <strong>Bản tạm</strong>, đang chờ duyệt pháp lý. Nội dung ghi XXX là phần chưa có.
        </p>
        {children}
      </div>
    </PublicShell>
  );
}
