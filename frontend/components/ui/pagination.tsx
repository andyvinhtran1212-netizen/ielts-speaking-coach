import { Button } from './button';
import styles from './pagination.module.css';
import { cx } from './cx';

export type PaginationProps = {
  /** 1-based. */
  page: number;
  totalPages: number;
  /** Total of the whole list, e.g. "549 đề". */
  totalLabel?: string;
  /** Link of a page; pages are URLs so the list can be shared and reloaded. */
  hrefFor: (page: number) => string;
  className?: string;
};

/**
 * "‹ Trước · Trang 2 trên 11 · 549 đề · Sau ›" (UIBASE-0056 FR-005, ThanhPhan §6).
 * Server-safe: no client state. First/last page disable the matching link.
 */
export function Pagination({ page, totalPages, totalLabel, hrefFor, className }: PaginationProps) {
  if (totalPages <= 1) return null;
  const current = Math.min(Math.max(1, page), totalPages);
  return (
    <nav aria-label="Phân trang" className={cx(styles.pagination, className)}>
      <Button variant="secondary" href={current > 1 ? hrefFor(current - 1) : ""} disabled={current === 1} rel="prev" aria-label="Trang trước">
        <span aria-hidden="true">‹ Trước</span>
      </Button>
      <span className={styles.status}>
        Trang {current} trên {totalPages}
        {totalLabel ? ` · ${totalLabel}` : null}
      </span>
      <Button variant="secondary" href={current < totalPages ? hrefFor(current + 1) : ""} disabled={current === totalPages} rel="next" aria-label="Trang sau">
        <span aria-hidden="true">Sau ›</span>
      </Button>
    </nav>
  );
}
