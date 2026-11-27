import { contactRows, type SiteContact } from '@/lib/site-info-model.mjs';

import styles from './contact-channels.module.css';
import { cx } from './cx';

export type ContactChannelsProps = {
  /** `contact` of GET /api/public/site-info (read with `getSiteInfo()`). */
  contact: Partial<SiteContact> | null | undefined;
  /** Heading above the rows; omit when the page already titles the block. */
  title?: string;
  className?: string;
};

/**
 * Shared contact block (PUBLICSITE-0059 FR-026): Email · Điện thoại · Zalo ·
 * Giờ trả lời, in that order, from the one site-info source. A line without a
 * value is left out; with none at all the block is a link to /contact, never
 * a placeholder number.
 */
export function ContactChannels({ contact, title, className }: ContactChannelsProps) {
  const rows = contactRows(contact);
  return (
    <section className={cx(styles.block, className)} aria-label={title ? undefined : 'Liên hệ'}>
      {title ? <h2 className={styles.title}>{title}</h2> : null}
      {rows.length === 0 ? (
        <p className={styles.fallback}>
          <a href="/contact">Gửi lời nhắn qua trang Liên hệ</a>
        </p>
      ) : (
        <dl className={styles.rows}>
          {rows.map((row) => (
            <div key={row.key} className={styles.row} data-channel={row.key}>
              <dt className={styles.label}>{row.label}</dt>
              <dd className={styles.value}>{row.href ? <a href={row.href}>{row.value}</a> : row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
