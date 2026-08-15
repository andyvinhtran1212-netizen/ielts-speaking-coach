import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getRoadmap } from '@/lib/grammar-api';
import { normalizePublicRoadmap } from '@/lib/public-roadmap-model.mjs';
import { articleUrl, LevelBadge, UpdatingBadge, type Article } from '../grammar-cards';
import { PersonalRoadmap } from './personal-roadmap';

type RoadmapData = { slug?: string; title?: string; articles?: Article[] };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function querySlug(params: Record<string, string | string[] | undefined>) {
  return typeof params.slug === 'string' ? params.slug.trim() : '';
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const slug = querySlug(await searchParams);
  if (!slug) return { title: 'Lộ trình của bạn — Grammar Wiki' };
  const data = await getRoadmap(slug) as RoadmapData | null;
  if (!data) notFound();
  const roadmap = normalizePublicRoadmap(data) as { title: string };
  return { title: `${roadmap.title} — Lộ trình học — Grammar Wiki` };
}

function Breadcrumb({ slug, title }: { slug?: string; title?: string }) {
  return (
    <nav className="gw-subnav sticky top-0 z-20 border-b border-white/5" aria-label="Grammar Wiki"
      style={{ background: 'var(--av-surface-sunken)', backdropFilter: 'blur(12px)' }}>
      <div className="av-w-page h-12 flex items-center">
        <div id="breadcrumb" className="flex items-center text-sm text-white/40 flex-wrap gap-0">
          <a href="/grammar" className="hover:text-teal-light transition-colors">Grammar Wiki</a>
          {slug ? (
            <>
              <span className="mx-2 text-white/20">›</span>
              <a href={`/grammar?category=${encodeURIComponent(slug)}`} className="hover:text-teal-light transition-colors capitalize">{title || slug.replace(/-/g, ' ')}</a>
            </>
          ) : null}
          <span className="mx-2 text-white/20">›</span>
          <span className="text-white/80">Lộ trình</span>
        </div>
      </div>
    </nav>
  );
}

function RoadmapSkeleton() {
  return (
    <>
      <Breadcrumb />
      <div id="roadmap-skeleton" className="av-w-page py-8">
        <div className="skeleton h-8 w-64 rounded-lg mb-2" />
        <div className="skeleton h-4 w-40 rounded mb-10" />
        <div className="space-y-6">
          {[0, 1, 2].map((key) => <div key={key} className="flex gap-5"><div className="skeleton w-10 h-10 rounded-full flex-shrink-0" /><div className="flex-1"><div className="skeleton h-5 w-48 rounded mb-2" /><div className="skeleton h-4 w-full rounded mb-2" /><div className="skeleton h-4 w-3/4 rounded" /></div></div>)}
        </div>
      </div>
    </>
  );
}

function RoadmapSteps({ articles }: { articles: Article[] }) {
  if (!articles.length) return <p className="text-white/40 text-sm py-8 text-center">Chưa có bài nào trong lộ trình này.</p>;
  return (
    <div className="relative">
      <div className="absolute left-5 top-10 bottom-10 w-0.5 bg-white/6" />
      {articles.map((article, index) => {
        const updating = article.status === 'updating';
        return (
          <div className="relative flex gap-5 mb-6 last:mb-0" key={`${article.category}/${article.slug}`}>
            <div className={`flex-shrink-0 w-10 h-10 rounded-full ${updating ? 'bg-white/5 border border-white/10' : 'bg-teal/15 border border-teal/30'} flex items-center justify-center z-10`}>
              <span className={`text-sm font-bold ${updating ? 'text-white/30' : 'text-teal-light'}`}>{index + 1}</span>
            </div>
            <div className="flex-1 pt-1 pb-6">
              <div className="flex items-start gap-2 mb-1">
                <h3 className={`font-semibold ${updating ? 'text-white/50' : 'text-white'} leading-snug`}>{article.title}</h3>
                {updating ? <UpdatingBadge /> : <LevelBadge level={article.level} />}
              </div>
              <p className="text-sm text-white/50 mb-3 leading-relaxed">{article.summary || ''}</p>
              <div className="flex items-center gap-3">
                <a href={articleUrl(article.category, article.slug)} className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg ${updating ? 'bg-white/5 text-white/30 cursor-default' : 'bg-teal/15 text-teal-light hover:bg-teal/25'} text-sm font-medium transition-colors`}>
                  {updating ? 'Sắp ra mắt' : 'Học ngay →'}
                </a>
                <span className="text-xs text-white/25">{article.reading_time || 1} phút</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function RoadmapBody({ searchParams }: { searchParams: SearchParams }) {
  const slug = querySlug(await searchParams);
  if (!slug) return <PersonalRoadmap />;
  const data = await getRoadmap(slug) as RoadmapData | null;
  if (!data) notFound();
  const roadmap = normalizePublicRoadmap(data) as { title: string; articles: Article[] };
  const { articles, title } = roadmap;
  return (
    <>
      <Breadcrumb slug={slug} title={title} />
      <main id="roadmap-container" className="av-w-page py-8 ds-fadein">
        <div className="mb-8">
          <p className="eyebrow">Grammar Wiki</p>
          <h1 id="roadmap-title" className="text-2xl font-extrabold text-white mb-1">Lộ trình: {title}</h1>
          <p id="roadmap-subtitle" className="text-sm text-white/40">{articles.length} bài học theo thứ tự từ cơ bản đến nâng cao</p>
        </div>
        <div id="roadmap-steps" className="mb-10"><RoadmapSteps articles={articles} /></div>
        <div className="border-t border-white/6 pt-6">
          <a id="roadmap-cat-link" href={`/grammar?category=${encodeURIComponent(slug)}`} className="text-sm text-teal-light hover:underline">Xem tất cả bài {title} →</a>
        </div>
      </main>
    </>
  );
}

export default function GrammarRoadmapPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      {/* @ts-ignore custom element được đăng ký bởi public-content layout */}
      <aver-chrome active="grammar" />
      <Suspense fallback={<RoadmapSkeleton />}><RoadmapBody searchParams={searchParams} /></Suspense>
    </>
  );
}
