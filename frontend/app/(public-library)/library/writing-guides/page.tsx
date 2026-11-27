// `/library/writing-guides` — Kiến thức Writing list (LIBRARY-0061 T011 =
// G06-T11; tờ KienThucWriting §1; FR-020).
//
// - Public: no login, no activation gate (FR-001).
// - Four fixed groups, Task 1 · Task 2 · Tiêu chí chấm · Dạng đề. A guide in
//   two groups is listed in both with the same URL. A group with no guide is
//   hidden; with no guide at all the page says so (ui-states).
// - A failed read says so and offers "Tải lại"; it never shows the empty state
//   as if there were no guides.
// - Exactly one course link, at the end (FR-003).
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { CourseLinkLine } from '@/components/library/course-link-line';
import { Breadcrumb } from '@/components/ui';

import { loadGuideList } from './guides-data';
import { GuideGroups, GuidesError, GuidesSkeleton, Intro } from './guides-list';
import styles from './writing-guides.module.css';

export const metadata: Metadata = {
  title: 'Kiến thức IELTS Writing: Task 1, Task 2, tiêu chí chấm, dạng đề | Thư viện Aver Learning',
  description:
    'Bài giải thích cách viết IELTS Writing Task 1 và Task 2, cách người chấm đọc bài theo bốn tiêu chí và cách làm từng dạng đề. Đọc miễn phí, không cần tài khoản.',
  alternates: { canonical: '/library/writing-guides' },
};

async function GuidesBody() {
  // Per request: never prerendered at build, so `next build` needs no backend.
  await connection();
  const loaded = await loadGuideList();
  if (loaded.state !== 'ok') {
    return (
      <>
        <Intro total={null} />
        <GuidesError />
      </>
    );
  }
  return (
    <>
      <Intro total={loaded.data.total} />
      <GuideGroups data={loaded.data} />
    </>
  );
}

export default function WritingGuidesPage() {
  return (
    <div className={styles.page}>
      <Breadcrumb items={[{ label: 'Thư viện', href: '/library' }, { label: 'Kiến thức Writing' }]} />
      <h1 className={styles.title}>Kiến thức Writing</h1>
      <Suspense
        fallback={
          <>
            <Intro total={null} />
            <GuidesSkeleton />
          </>
        }
      >
        <GuidesBody />
      </Suspense>
      <CourseLinkLine href="/" linkLabel="Xem các khoá học">
        Đọc ở đây là miễn phí. Muốn nộp bài để được chấm theo bốn tiêu chí, cần một khoá học.
      </CourseLinkLine>
    </div>
  );
}
