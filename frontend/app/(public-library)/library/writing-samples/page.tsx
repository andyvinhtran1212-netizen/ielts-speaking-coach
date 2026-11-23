// `/library/writing-samples` — Writing sample list (LIBRARY-0061 T009 = G06-T09;
// tờ BaiMauWritingDanhSach.dc.html; FR-010, FR-011, FR-012).
//
// - Public: no login, no activation gate (FR-001).
// - The server renders the list for the URL's filters, so a shared link such
//   as `?task=task2&dang=opinion&q=work` opens in that state with JS off.
//   Filters and pages live only in the URL (`task`, `dang`, `chude`, `q`,
//   `trang`); the client replaces the URL and the server renders again.
// - The list is read uncached (`no-store`), so a withdrawn set disappears on
//   the next request (FR-019). A failed read keeps the filters and offers
//   "Tải lại" for the same query (FR-011); it never shows an empty list as if
//   there were no samples.
// - The "Của bạn" column and filter group wait for T016 (marks API) and are
//   not rendered yet.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { CourseLinkLine } from '@/components/library/course-link-line';
import { Breadcrumb } from '@/components/ui';
import { API_BASE, ABORT_MS } from '@/lib/backend';
import { routeFor } from '@/lib/route-registry.mjs';
import { listApiPath, parseListQuery } from '@/lib/writing-samples-list-model.mjs';

import { WritingSamplesBrowser, WritingSamplesSkeleton, type SampleList } from './writing-samples-browser';
import styles from './writing-samples.module.css';

export const metadata: Metadata = {
  title: 'Bài mẫu IELTS Writing ba mức điểm 7.5, 7.0, 6.0 | Thư viện Aver Learning',
  description:
    'Bài mẫu IELTS Writing Task 1 và Task 2, mỗi đề có ba bài cùng dàn ý ở mức 7.5, 7.0 và 6.0. Lọc theo Task, dạng đề, chủ đề. Đọc miễn phí, không cần tài khoản.',
  alternates: { canonical: '/library/writing-samples' },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function loadList(path: string): Promise<SampleList | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(ABORT_MS) });
    if (!res.ok) {
      console.error(`[library] ${path} → HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as SampleList;
    return Array.isArray(data?.items) && typeof data.total === 'number' ? data : null;
  } catch (error) {
    console.error(`[library] ${path} failed`, error);
    return null;
  }
}

async function ListBody({ searchParams }: { searchParams: SearchParams }) {
  // Per request: never prerendered at build, so `next build` needs no backend.
  await connection();
  const query = parseListQuery(await searchParams);
  const data = await loadList(listApiPath(query));
  // Rows link to a sample's page only once T010 serves it (no link to a 404).
  const detailLive = routeFor('/library/writing-samples/x')?.status === 'live';
  return <WritingSamplesBrowser query={query} data={data} detailLive={detailLive} />;
}

export default function WritingSamplesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className={styles.page}>
      <Breadcrumb items={[{ label: 'Thư viện', href: '/library' }, { label: 'Bài mẫu Writing' }]} />
      <header className={styles.intro}>
        <h1>Bài mẫu Writing</h1>
        <p>
          Mỗi đề có ba bài viết cùng một dàn ý, ở mức 7.5, 7.0 và 6.0. Trang của từng đề đặt hai mức cạnh nhau và
          chỉ ra từng chỗ khác: câu nào đổi, thuộc tiêu chí chấm nào, vì sao làm bài tụt band.
        </p>
        <p className={styles.meta}>Đọc miễn phí, không cần tài khoản · Aver Learning biên soạn</p>
      </header>
      <Suspense fallback={<WritingSamplesSkeleton />}>
        <ListBody searchParams={searchParams} />
      </Suspense>
      <CourseLinkLine href="/" linkLabel="Xem các khoá học">
        Muốn tự viết một đề và được chấm theo bốn tiêu chí? Việc này cần một khoá học.
      </CourseLinkLine>
    </div>
  );
}
