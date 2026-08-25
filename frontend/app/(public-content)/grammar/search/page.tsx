import type { Metadata } from 'next';
import { Suspense } from 'react';

import { GrammarSearchBehavior } from './search-behavior';

export const metadata: Metadata = {
  title: 'Tìm kiếm Grammar Wiki — Aver Learning',
  description: 'Tìm bài ngữ pháp theo chủ đề, trình độ và kỹ năng IELTS.',
};

function SearchSkeleton() {
  return <div className="skeleton h-72 rounded-2xl" aria-label="Đang tải kết quả" />;
}

export default function GrammarSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      {/* @ts-ignore */}
      <aver-chrome active="grammar" />
      <main className="av-w-page py-8 pb-20">
        <nav className="text-sm text-white/40 mb-4" aria-label="Breadcrumb">
          <a href="/grammar" className="hover:text-white/70">Grammar Wiki</a>
          <span className="mx-2">/</span><span className="text-white/65">Tìm kiếm</span>
        </nav>
        <header className="mb-7">
          <p className="eyebrow">Tra cứu có định hướng</p>
          <h1 className="text-3xl font-extrabold text-white mb-2">Tìm đúng điểm ngữ pháp</h1>
          <p className="text-white/45 max-w-2xl">Lọc theo trình độ và kỹ năng sử dụng thay vì dò trong một danh sách dài.</p>
        </header>
        <Suspense fallback={<SearchSkeleton />}>
          <GrammarSearchBehavior searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}
