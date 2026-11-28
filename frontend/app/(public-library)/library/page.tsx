// `/library` — hub of the public Library (LIBRARY-0061 T008; tờ ThuVien.dc.html).
// The sheet has no "Ghi chú cho lập trình" section: built from its layout under
// the shared FRs 001–005 and FR-063.
//
// - Shelves come from `LIBRARY_SHELVES` (FR-063), never hard-coded here.
// - Counts come from `GET /api/library/summary`; a shelf the API cannot count
//   shows no number, and a failed summary still shows every shelf (FR-004,
//   ui-states). Nothing here blocks reading behind a login (FR-001).
// - A shelf links to its page only once that page is `live` in the route
//   registry, so the hub never links to a 404 while T009/T011/T013 are pending.
// - The Writing shelf shows one real sample read from the API (prompt, one
//   band, what changes between bands); the band is kept in the URL (`?ban=`).
// - Exactly one course link, at the end (FR-003).
//
// Library JSON is read uncached (`no-store`), so a sample withdrawn from the
// Library disappears from this page on the next request (FR-019).
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { CourseLinkLine } from '@/components/library/course-link-line';
import { PUBLIC_HREF } from '@/components/ui/shell/public-links';
import { API_BASE, ABORT_MS } from '@/lib/backend';
import { LIBRARY_SHELVES, shelvesWithCounts, type SummaryEntry } from '@/lib/library-shelves.mjs';
import { routeFor } from '@/lib/route-registry.mjs';

import styles from './library.module.css';

export const metadata: Metadata = {
  title: 'Thư viện IELTS miễn phí: bài mẫu Writing, đề Speaking, ngữ pháp, từ vựng | Aver Learning',
  description:
    'Đọc và xem miễn phí, không cần tài khoản: bài mẫu Writing ba mức điểm, kiến thức Writing, đề Speaking có câu trả lời mẫu, ngữ pháp và từ vựng.',
  alternates: { canonical: '/library' },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Summary = Record<string, SummaryEntry>;

const BANDS = ['7.5', '7.0', '6.0'] as const;
type Band = (typeof BANDS)[number];

type SampleListItem = { slug: string; title_en: string | null; task: string | null; question_type_label: string | null };
type SampleDelta = { criterion: string | null; before: string | null; after: string | null; why: string | null };
type SampleDetail = {
  slug: string;
  title_en: string | null;
  task: 'task2' | 'task1' | null;
  question_type_label: string | null;
  prompt_text: string | null;
  essays: Partial<Record<Band, { text: string | null } | undefined>>;
  delta_75_70: SampleDelta[];
  delta_70_60: SampleDelta[];
};

/** GET a Library endpoint, uncached. Any failure is logged and read as "no data". */
async function getLibraryJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(ABORT_MS) });
    if (!res.ok) {
      console.error(`[library] ${path} → HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.error(`[library] ${path} failed`, error);
    return null;
  }
}

function isLive(href: string): boolean {
  return routeFor(href)?.status === 'live';
}

function pickBand(value: string | string[] | undefined): Band {
  const raw = Array.isArray(value) ? value[0] : value;
  return (BANDS as readonly string[]).includes(raw ?? '') ? (raw as Band) : '7.5';
}

function firstParagraph(text: string | null | undefined): string | null {
  const para = (text ?? '').split(/\n\s*\n/).map((p) => p.trim()).find(Boolean);
  return para || null;
}

async function loadSample(): Promise<SampleDetail | null> {
  const list = await getLibraryJson<{ items?: SampleListItem[] }>('/api/library/writing-samples?task=task2&dang=opinion');
  const slug = list?.items?.[0]?.slug;
  if (!slug) return null;
  const detail = await getLibraryJson<SampleDetail>(`/api/library/writing-samples/${encodeURIComponent(slug)}`);
  return detail?.essays && firstParagraph(detail.essays['7.5']?.text) ? detail : null;
}

function WritingExcerpt({ sample, band }: { sample: SampleDetail; band: Band }) {
  const shown = sample.essays[band]?.text ? band : '7.5';
  const paragraph = firstParagraph(sample.essays[shown]?.text);
  const deltas = shown === '7.5' ? sample.delta_75_70 : sample.delta_70_60;
  const deltaTitle = shown === '7.5' ? 'Từ 7.0 lên 7.5' : 'Từ 6.0 lên 7.0';
  const detailHref = `/library/writing-samples/${sample.slug}`;
  const kind = ['Task 2', sample.question_type_label].filter(Boolean).join(' · ');
  const notes = (deltas ?? []).filter((d) => d.why).slice(0, 2);

  return (
    <div className={styles.excerpt} data-testid="writing-excerpt">
      <div className={styles.excerptMain}>
        <p className={styles.eyebrow}>{kind}</p>
        {sample.prompt_text ? <p lang="en" className={styles.prompt}>{sample.prompt_text}</p> : null}
        <nav aria-label="Mức điểm của bài mẫu" className={styles.bands}>
          {BANDS.filter((b) => sample.essays[b]?.text).map((b) => (
            <a
              key={b}
              href={b === '7.5' ? '/library#bai-mau-writing' : `/library?ban=${b}#bai-mau-writing`}
              aria-current={b === shown ? 'true' : undefined}
              className={b === shown ? `${styles.band} ${styles.bandOn}` : styles.band}
            >
              Band {b}
            </a>
          ))}
        </nav>
        {paragraph ? <p lang="en" className={styles.essay}>{paragraph}</p> : null}
      </div>
      <aside className={styles.excerptSide}>
        {notes.length > 0 ? (
          <>
            <p className={styles.eyebrow}>{deltaTitle}</p>
            <ul className={styles.deltaList}>
              {notes.map((d, i) => (
                <li key={i}>
                  {d.criterion ? <span className={styles.criterion}>{d.criterion}</span> : null}
                  {d.why}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {isLive(detailHref) ? <a href={detailHref}>Đọc cả bài, dàn ý và bảng từ vựng</a> : null}
      </aside>
    </div>
  );
}

function Shelves({ summary, sample, band }: { summary: Summary | null; sample: SampleDetail | null; band: Band }) {
  const rows = shelvesWithCounts(LIBRARY_SHELVES, summary);
  return (
    <>
      <nav aria-label="Các kệ" className={styles.shelfIndex}>
        <ul>
          {rows.map(({ shelf }) => (
            <li key={shelf.id}>
              <a href={`#${shelf.id}`}>{shelf.title}</a>
            </li>
          ))}
        </ul>
      </nav>
      {rows.map(({ shelf, countText }) => (
        <section key={shelf.id} id={shelf.id} aria-labelledby={`${shelf.id}-title`} className={styles.shelf} data-shelf={shelf.id}>
          <div className={styles.shelfHead}>
            <h2 id={`${shelf.id}-title`} className={styles.shelfTitle}>
              {isLive(shelf.href) ? <a href={shelf.href}>{shelf.title}</a> : shelf.title}
            </h2>
            {countText ? <p className={styles.count}>{countText}</p> : null}
          </div>
          <p className={styles.shelfText}>{shelf.description}</p>
          {shelf.id === 'bai-mau-writing' && sample ? <WritingExcerpt sample={sample} band={band} /> : null}
        </section>
      ))}
    </>
  );
}

async function LibraryBody({ searchParams }: { searchParams: SearchParams }) {
  // Per request: summary and sample are read live, never prerendered at build.
  await connection();
  const [params, summary, sample] = await Promise.all([
    searchParams,
    getLibraryJson<Summary>('/api/library/summary'),
    loadSample(),
  ]);
  return <Shelves summary={summary} sample={sample} band={pickBand(params.ban)} />;
}

export default function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <h1>Thư viện</h1>
        <p>
          Đọc và xem miễn phí, không cần tài khoản. Muốn nộp bài để được chấm thì cần một khoá học.
        </p>
      </header>
      {/* While counts load: every shelf, no numbers (no fake "0"). */}
      <Suspense fallback={<Shelves summary={null} sample={null} band="7.5" />}>
        <LibraryBody searchParams={searchParams} />
      </Suspense>
      <CourseLinkLine href={PUBLIC_HREF.courses} linkLabel="Xem các khoá học">
        Đọc trong Thư viện luôn miễn phí. Muốn nộp bài Writing và Speaking để được chấm theo bốn tiêu chí, cần một khoá học:
      </CourseLinkLine>
    </div>
  );
}
