import type { Metadata } from 'next';
import { Suspense } from 'react';

import { VocabUnitLesson } from './vocab-unit-lesson';

export const metadata: Metadata = {
  title: 'Learning Unit — Vocab Curated',
  robots: { index: false, follow: false },
};

async function VocabUnitRoute({ params }: { params: Promise<{ unitSlug: string }> }) {
  const { unitSlug } = await params;
  return (
    <>
      {/* @ts-ignore custom element được đăng ký bởi AuthedShell. */}
      <aver-chrome active="vocabulary" />
      <main className="vc-shell">
        <header className="vc-topbar"><a href="/vocabulary/learn">← Vocab Curated</a><a href="/vocabulary">Reference Wiki</a></header>
        <VocabUnitLesson unitSlug={unitSlug} />
      </main>
    </>
  );
}

export default function VocabUnitPage({ params }: { params: Promise<{ unitSlug: string }> }) {
  return (
    <Suspense fallback={<main className="vc-shell"><section className="vc-state" role="status">Đang mở learning unit…</section></main>}>
      <VocabUnitRoute params={params} />
    </Suspense>
  );
}
