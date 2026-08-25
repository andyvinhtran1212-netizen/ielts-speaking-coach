import type { Metadata } from 'next';

import { getHome } from '@/lib/grammar-api';
import { GrammarRoadmapBehavior } from './roadmap-behavior';

export const metadata: Metadata = {
  title: 'Lộ trình Grammar — Aver Learning',
  description: 'Học ngữ pháp theo prerequisite và điểm yếu thực tế của bạn.',
};

export default async function GrammarRoadmapPage() {
  const home = await getHome();
  return (
    <>
      {/* @ts-ignore */}
      <aver-chrome active="grammar" />
      <main className="av-w-page py-8 pb-20">
        <nav className="text-sm text-white/40 mb-4" aria-label="Breadcrumb"><a href="/grammar" className="hover:text-white/70">Grammar Wiki</a><span className="mx-2">/</span><span className="text-white/65">Lộ trình</span></nav>
        <header className="mb-8"><p className="eyebrow">Học theo quan hệ</p><h1 className="text-3xl font-extrabold text-white mb-2">Lộ trình Grammar</h1><p className="text-white/45 max-w-2xl">Prerequisite đi trước, điểm yếu đi sau. Khi chưa có evidence cá nhân, bạn vẫn có thể chọn một chủ đề để học tuần tự.</p></header>
        <GrammarRoadmapBehavior categories={home?.categories || []} />
      </main>
    </>
  );
}
