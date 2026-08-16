import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ReadingDetail } from '../../reading-detail';
import { ReadingDetailAssets } from '../../reading-detail-assets';

export const metadata: Metadata = {
  title: 'Bài luyện kỹ năng — Aver Learning',
  robots: { index: false, follow: false },
};

async function ReadingSkillDetailRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <>
      <ReadingDetailAssets />
      {/* @ts-ignore custom element supplied by the coexistence chrome */}
      <aver-chrome active="reading" />
      <ReadingDetail library="skill" slug={slug} />
    </>
  );
}

export default function ReadingSkillDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  return <Suspense fallback={<main className="rv-shell"><div className="rv-empty" role="status">Đang mở bài luyện…</div></main>}><ReadingSkillDetailRoute params={params} /></Suspense>;
}
