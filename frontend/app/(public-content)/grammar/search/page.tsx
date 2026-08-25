import type { Metadata } from 'next';
import { Suspense } from 'react';

import { getSearch } from '@/lib/grammar-api';
import { SearchResultCards, type Article } from '../grammar-cards';
import { SearchBox } from '../search-box';

export const metadata: Metadata = {
  title: 'Tìm kiếm — Grammar Wiki — IELTS Speaking Coach',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function matchesUse(article: Article, use: string) {
  if (!use) return true;
  if (use === 'speaking') return article.speaking_relevance === 'high';
  if (use === 'writing') return article.writing_relevance === 'high' || article.category === 'grammar-for-writing';
  if (use === 'reading') return article.category === 'grammar-for-reading';
  return true;
}

function ResultsSkeleton() {
  return (
    <div id="search-skeleton" className="av-w-page py-8">
      <div className="skeleton h-8 w-64 rounded-lg mb-4" />
      <div className="skeleton h-12 w-full rounded-xl mb-8" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="skeleton h-28 rounded-xl" />
        <div className="skeleton h-28 rounded-xl" />
        <div className="skeleton h-28 rounded-xl" />
      </div>
    </div>
  );
}

async function SearchResults({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const raw = typeof params.q === 'string' ? params.q : '';
  const query = raw.trim();
  const level = typeof params.level === 'string' && ['beginner', 'intermediate', 'advanced'].includes(params.level)
    ? params.level : '';
  const use = typeof params.use === 'string' && ['speaking', 'writing', 'reading'].includes(params.use)
    ? params.use : '';
  const results = query ? await getSearch(query) : [];
  const articles = (Array.isArray(results) ? results as Article[] : []).filter((article) => {
    const levelMatches = !level || article.level?.toLowerCase() === level;
    return levelMatches && matchesUse(article, use);
  });

  return (
    <main id="search-container" className="av-w-page py-8 ds-fadein">
      <div className="mb-8">
        <SearchBox initialQuery={raw} className="relative mb-4" />
        <form method="get" className="gw-filter-row" aria-label="Bộ lọc kết quả">
          <input type="hidden" name="q" value={query} />
          <label>Trình độ
            <select name="level" defaultValue={level}>
              <option value="">Tất cả</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <label>Mục tiêu
            <select name="use" defaultValue={use}>
              <option value="">Tất cả</option>
              <option value="speaking">Speaking</option>
              <option value="writing">Writing</option>
              <option value="reading">Reading</option>
            </select>
          </label>
          <button type="submit" className="gw-filter-reset">Áp dụng</button>
          {(level || use) ? <a className="gw-filter-reset" href={`/grammar/search?q=${encodeURIComponent(query)}`}>Xóa bộ lọc</a> : null}
        </form>
      </div>

      <div className="mb-5">
        <p className="eyebrow">Grammar Wiki</p>
        <div className="flex items-baseline gap-3">
          <h1 id="search-heading" className="text-xl font-bold text-white">
            {query ? `Kết quả cho "${query}"` : 'Tìm kiếm Grammar'}
          </h1>
          <span id="search-count" className="text-sm text-white/35 font-normal">
            {articles.length ? `${articles.length} kết quả` : ''}
          </span>
        </div>
      </div>

      <div id="search-results-list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {query
          ? <SearchResultCards articles={articles} query={query} />
          : <p className="text-white/40 text-sm col-span-3 py-8 text-center">Nhập từ khóa để tìm kiếm.</p>}
      </div>
    </main>
  );
}

export default function GrammarSearchPage({ searchParams }: { searchParams: SearchParams }) {
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
            <span className="text-white/80">Tìm kiếm</span>
          </div>
        </div>
      </nav>
      <Suspense fallback={<ResultsSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </>
  );
}
