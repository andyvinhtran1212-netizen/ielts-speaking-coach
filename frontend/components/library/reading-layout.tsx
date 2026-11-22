'use client';

/**
 * Shared reading page frame of the public Library (LIBRARY-0061 T007, FR-021):
 * one template for Kiến thức Writing and Ngữ pháp (tờ KienThucWriting §2–3,
 * NguPhap). Three columns from 1024px: in-page contents 224px (sticky, the
 * section being read has a 3px left rule and bold label), text column 640px in
 * Source Serif 4 18/29, notes column 248px. Below 1024px: one column, the
 * contents become a closed-by-default disclosure and notes sit right under
 * their paragraph.
 *
 * All article content arrives as children from a Server Component, so it is in
 * the server HTML (FR-001); only the "đang đọc" tracking runs in the browser.
 */
import { useEffect, useState, type ReactNode } from 'react';

import styles from './reading-layout.module.css';

export type ReadingTocItem = {
  /** `id` of the heading element in the article. */
  id: string;
  label: string;
  /** Visible section number, e.g. "1" or "2.1". Omitted for unnumbered rows. */
  n?: string;
};

export type ReadingLayoutProps = {
  /** Sections in reading order; an empty list hides the contents column. */
  toc: readonly ReadingTocItem[];
  /** Header of the article (eyebrow, H1, "Đọc khoảng … · cập nhật …"). */
  header: ReactNode;
  /** Article body: ReadingBlock rows and headings with the ids listed in `toc`. */
  children: ReactNode;
  /** Small text under the contents on wide screens, e.g. "Thuộc nhóm …". */
  tocFooter?: ReactNode;
  /** Label of the contents block. */
  tocLabel?: string;
};

/**
 * Picks the section being read: the last section whose heading has passed the
 * reading line (top 30% of the viewport), or the first one before any has.
 * Exported for tests.
 */
export function pickActiveSection(
  ids: readonly string[],
  passed: ReadonlySet<string>,
): string | null {
  let active: string | null = ids[0] ?? null;
  for (const id of ids) {
    if (passed.has(id)) active = id;
  }
  return active;
}

function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join('\u0000');

  useEffect(() => {
    const list = key ? key.split('\u0000') : [];
    if (list.length === 0 || typeof IntersectionObserver === 'undefined') return undefined;
    const passed = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          // Above the reading line once it is intersecting or has scrolled past the top.
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) passed.add(id);
          else passed.delete(id);
        }
        setActive(pickActiveSection(list, passed));
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    for (const id of list) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [key]);

  return active;
}

function TocList({ toc, active }: { toc: readonly ReadingTocItem[]; active: string | null }) {
  return (
    <ol className={styles.tocList}>
      {toc.map((item) => {
        const current = item.id === active;
        return (
          <li key={item.id} className={current ? `${styles.tocItem} ${styles.tocCurrent}` : styles.tocItem}>
            <a href={`#${item.id}`} aria-current={current ? 'location' : undefined}>
              {item.n ? <span className={styles.tocNum}>{item.n}</span> : null}
              {item.label}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

export function ReadingLayout({
  toc,
  header,
  children,
  tocFooter,
  tocLabel = 'Trong bài này',
}: ReadingLayoutProps) {
  const active = useActiveSection(toc.map((item) => item.id));
  const hasToc = toc.length > 0;

  return (
    <div className={hasToc ? styles.layout : `${styles.layout} ${styles.noToc}`}>
      {hasToc ? (
        <aside className={styles.tocColumn}>
          <nav aria-label={tocLabel} className={styles.tocWide}>
            <p className={styles.tocHeading}>{tocLabel}</p>
            <TocList toc={toc} active={active} />
            {tocFooter ? <div className={styles.tocFooter}>{tocFooter}</div> : null}
          </nav>
        </aside>
      ) : null}
      <article className={styles.article}>
        <header className={styles.header}>{header}</header>
        {hasToc ? (
          <details className={styles.tocNarrow} data-testid="reading-toc-narrow">
            <summary>
              {tocLabel} · {toc.length} mục
            </summary>
            <nav aria-label={tocLabel}>
              <TocList toc={toc} active={active} />
            </nav>
          </details>
        ) : null}
        <div className={styles.body}>{children}</div>
      </article>
    </div>
  );
}

export type ReadingBlockProps = {
  children: ReactNode;
  /** Margin content for this block (MarginNote items); wide: right column, narrow: under the block. */
  notes?: ReactNode;
};

/**
 * One row of the article: the text (640px) and its margin notes (248px). Notes
 * of a block start at the top of that block, so a note never drifts away from
 * the paragraph it explains.
 */
export function ReadingBlock({ children, notes }: ReadingBlockProps) {
  return (
    <div className={styles.block}>
      <div className={styles.text}>{children}</div>
      {notes ? <aside className={styles.notes}>{notes}</aside> : null}
    </div>
  );
}
