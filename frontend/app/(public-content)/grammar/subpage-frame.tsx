/**
 * Shared frame of the Grammar sub-pages `search`, `compare`, `roadmap`,
 * `exercises` (LIBRARY-0061 T014 PR (c), FR-040): same URLs and behaviour,
 * "Bản in" style. Server Component; the client parts stay in each page.
 *
 * Like the article page (PR (a)), the routes still sit in the legacy
 * `(public-content)` layout until `grammar-wiki.css` leaves it, so the av2
 * tokens and base rules are imported here and scoped by `.av2-root`.
 */
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';

import type { ReactNode } from 'react';

import { Breadcrumb, type BreadcrumbItem } from '@/components/ui';
import { av2FontClass } from '@/styles/av2/fonts';

import styles from './subpage-frame.module.css';

export { styles as frameStyles };

const LEVEL_LABELS: Record<string, string> = {
  beginner: 'Cơ bản',
  'beginner-intermediate': 'Cơ bản đến trung cấp',
  intermediate: 'Trung cấp',
  advanced: 'Nâng cao',
};

/** "intermediate" → "Trung cấp"; unknown values are shown as given, empty → null. */
export function levelLabel(level: string | null | undefined): string | null {
  if (!level) return null;
  return LEVEL_LABELS[level.toLowerCase()] || level;
}

/** "grammar-for-writing" → "Grammar for writing" (same words as the article eyebrow). */
export function categoryLabel(category: string | null | undefined): string {
  const words = (category || '').replace(/-/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/** "Trung cấp · Tenses · 4 phút" from whatever the row has. */
export function articleMeta(a: { level?: string | null; category?: string | null; reading_time?: number | null }): string {
  return [levelLabel(a.level), categoryLabel(a.category) || null, `${a.reading_time || 1} phút`].filter(Boolean).join(' · ');
}

const ROOT: BreadcrumbItem[] = [
  { label: 'Thư viện', href: '/library' },
  { label: 'Grammar Wiki', href: '/grammar' },
];

/** Legacy top bar + av2 page with the Grammar breadcrumb; `crumbs` follow "Grammar Wiki". */
export function SubpageFrame({ crumbs, children }: { crumbs: BreadcrumbItem[]; children: ReactNode }) {
  return (
    <>
      {/* The legacy layout's top bar stays until grammar-wiki.css leaves the layout. */}
      {/* @ts-ignore custom element registered by the public-content layout */}
      <aver-chrome active="grammar" />
      <div className={`av2-root ${av2FontClass} ${styles.page}`}>
        <div className={styles.inner}>
          <div id="breadcrumb">
            <Breadcrumb items={[...ROOT, ...crumbs]} />
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

/** Eyebrow, H1 and one intro line, as on the article page header. */
export function SubpageHeader({
  eyebrow = 'Grammar Wiki',
  title,
  titleId,
  intro,
  introId,
  aside,
}: {
  eyebrow?: string;
  title: ReactNode;
  titleId?: string;
  intro?: ReactNode;
  introId?: string;
  aside?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 id={titleId} className={styles.title}>{title}</h1>
      {intro !== undefined ? <p id={introId} className={styles.intro}>{intro}</p> : null}
      {aside}
    </header>
  );
}

/** Plain grey blocks in the page's column, no animation (same rule as the article skeleton). */
export function SubpageSkeleton({ id, rows = 3 }: { id: string; rows?: number }) {
  return (
    <div id={id} className={styles.skeleton} aria-hidden="true">
      <span className={styles.skelLine} data-w="eyebrow" />
      <span className={styles.skelLine} data-w="title" />
      {Array.from({ length: rows }, (_, i) => <span key={i} className={styles.skelBlock} />)}
    </div>
  );
}
