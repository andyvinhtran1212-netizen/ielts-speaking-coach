import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getCompare } from '@/lib/grammar-api';
import {
  articleUrl,
  CategoryBadge,
  LevelBadge,
  type Article,
} from '../grammar-cards';

type CompareArticle = Article & { html?: string };
type CompareData = { slug: string; left: CompareArticle; right: CompareArticle };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function querySlug(params: Record<string, string | string[] | undefined>) {
  return typeof params.slug === 'string' ? params.slug.trim() : '';
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const slug = querySlug(await searchParams);
  if (!slug) return { title: 'So sánh — Grammar Wiki — IELTS Speaking Coach' };
  const data = await getCompare(slug) as CompareData | null;
  if (!data) notFound();
  return { title: `${data.left.title} vs ${data.right.title} — Grammar Wiki` };
}

function CompareSkeleton() {
  return (
    <div id="compare-skeleton" className="av-w-page py-8">
      <div className="skeleton h-8 w-96 rounded-lg mb-8" />
      <div className="grid lg:grid-cols-2 gap-6">
        {[0, 1].map((key) => (
          <div key={key} className="space-y-3">
            <div className="skeleton h-6 w-48 rounded mb-4" />
            <div className="skeleton h-4 w-full rounded" />
            <div className="skeleton h-4 w-5/6 rounded" />
            <div className="skeleton h-4 w-4/5 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CompareColumn({ article, id }: { article: CompareArticle; id: string }) {
  return (
    <section id={id} className="compare-col">
      <div className="mb-4 flex items-center gap-2">
        <LevelBadge level={article.level} />
        <CategoryBadge category={article.category} />
        <span className="text-xs text-white/30">{article.reading_time || 1} phút</span>
      </div>
      <h2 className="text-xl font-bold text-white mb-2">{article.title}</h2>
      {article.summary ? (
        <p className="text-sm text-white/55 mb-4 leading-relaxed">{article.summary}</p>
      ) : null}
      <a
        href={articleUrl(article.category, article.slug)}
        className="inline-flex items-center gap-1.5 text-sm text-teal-light hover:underline mb-6"
      >
        Đọc bài đầy đủ →
      </a>
      {/* Nội dung này là HTML Markdown đã biên soạn từ GrammarContentService;
          legacy cũng render nguyên `article.html`. Text metadata phía trên vẫn
          do React escape, không mở rộng trust boundary sang dữ liệu khác. */}
      <div className="article-body" dangerouslySetInnerHTML={{ __html: article.html || '' }} />
    </section>
  );
}

function MissingSlug() {
  return (
    <main id="compare-container" className="av-w-page py-8 ds-fadein">
      <div id="compare-left" className="compare-col">
        <p className="text-red-400 text-sm py-4">Lỗi: Thiếu tham số slug.</p>
      </div>
    </main>
  );
}

async function CompareBody({ searchParams }: { searchParams: SearchParams }) {
  const slug = querySlug(await searchParams);
  if (!slug) return <MissingSlug />;

  const data = await getCompare(slug) as CompareData | null;
  if (!data) notFound();

  return (
    <main id="compare-container" className="av-w-page py-8 ds-fadein">
      <div className="mb-8">
        <p className="eyebrow">Grammar Wiki</p>
        <h1 id="compare-title" className="text-2xl font-extrabold">
          <span className="text-white">{data.left.title}</span>
          <span className="text-white/30 mx-3 font-normal">vs</span>
          <span className="text-teal-light">{data.right.title}</span>
        </h1>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <CompareColumn article={data.left} id="compare-left" />
        <CompareColumn article={data.right} id="compare-right" />
      </div>
    </main>
  );
}

export default function GrammarComparePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      {/* @ts-ignore custom element được đăng ký bởi public-content layout */}
      <aver-chrome active="grammar" />
      <nav
        className="gw-subnav sticky top-0 z-20 border-b border-white/5"
        aria-label="Grammar Wiki"
        style={{ background: 'var(--av-surface-sunken)', backdropFilter: 'blur(12px)' }}
      >
        <div className="av-w-page h-12 flex items-center">
          <div id="breadcrumb" className="flex items-center text-sm text-white/40 flex-wrap gap-0">
            <a href="/grammar" className="hover:text-teal-light transition-colors">Grammar Wiki</a>
            <span className="mx-2 text-white/20">›</span>
            <span className="text-white/80">So sánh</span>
          </div>
        </div>
      </nav>
      <Suspense fallback={<CompareSkeleton />}>
        <CompareBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}
