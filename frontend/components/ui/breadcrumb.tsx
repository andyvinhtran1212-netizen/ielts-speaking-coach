import styles from './breadcrumb.module.css';
import { cx } from './cx';

export type BreadcrumbItem = { label: string; href?: string };

export type BackLinkProps = {
  /** Name of the parent page, e.g. "Writing". Never a bare "Quay lại". */
  parentLabel: string;
  href: string;
  className?: string;
};

/**
 * "‹ {trang cha}" (UIBASE-0056 FR-005, KhungTrang §5): names where it goes.
 * The accessible name keeps the visible words ("Quay lại Writing").
 */
export function BackLink({ parentLabel, href, className }: BackLinkProps) {
  return (
    <a href={href} aria-label={`Quay lại ${parentLabel}`} className={cx(styles.back, className)}>
      <span aria-hidden="true">‹</span>
      {parentLabel}
    </a>
  );
}

export type BreadcrumbProps = {
  /** From the section down to the current page; the last item is the current page. */
  items: readonly BreadcrumbItem[];
  className?: string;
};

/**
 * Where the page sits (UIBASE-0056 FR-005, ThanhPhan §6, KhungTrang §5).
 * ≥768px: the full trail, last item not a link. <768px: only "‹ {parent}".
 * Both are in the markup, and CSS shows exactly one, so never both at once.
 */
export function Breadcrumb({ items, className }: BreadcrumbProps) {
  if (items.length < 2) return null;
  const parent = [...items.slice(0, -1)].reverse().find((item) => item.href);
  return (
    <div className={className}>
      <nav aria-label="Vị trí trang" className={styles.trail}>
        <ol className={styles.list}>
          {items.map((item, i) => {
            const last = i === items.length - 1;
            return (
              <li key={`${item.label}-${i}`} className={styles.item}>
                {last || !item.href
                  ? <span aria-current={last ? 'page' : undefined}>{item.label}</span>
                  : <a href={item.href}>{item.label}</a>}
                {last ? null : <span aria-hidden="true" className={styles.sep}>›</span>}
              </li>
            );
          })}
        </ol>
      </nav>
      {parent?.href ? <BackLink parentLabel={parent.label} href={parent.href} className={styles.phoneOnly} /> : null}
    </div>
  );
}
