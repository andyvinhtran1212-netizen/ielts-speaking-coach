// Trang chủ Grammar Wiki — route Next canonical `/grammar` (Phase 3, route đầu).
//
// Dark-launch theo nghĩa mạnh nhất: `/grammar` hiện đang 404 trên production và
// KHÔNG trang nào trỏ tới, nên dựng xong là chạy thật mà không ai bị ảnh hưởng.
// Cutover (redirect `/grammar.html` + đổi link nội bộ) làm sau khi cửa sổ quan
// sát pilot 3+4 đóng — để nếu `/profile` có sự cố thì còn quy kết một-biến.
//
// Khuôn PPR (cacheComponents): vỏ tĩnh prerender sẵn, phần đọc `searchParams`
// nằm SAU `Suspense`. Đây không phải lựa chọn thẩm mỹ — `searchParams` không
// được phép đọc bên trong `use cache`, mà mọi loader nội dung đều `use cache`.
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { getHome, getGroups, getCategory } from '../../../lib/grammar-api';
import { CategoryCards, FeaturedCards, GroupCards } from './grammar-cards';
import { SearchBox } from './search-box';

// Legacy `<title>` nguyên văn — parity tiêu đề là thứ người dùng thấy trên tab
// và Google thấy trong kết quả tìm kiếm.
export const metadata: Metadata = {
  title: 'Grammar Wiki — Aver Learning',
  description:
    'Tra cứu ngữ pháp IELTS theo hệ thống: 9 nhóm chủ đề, lộ trình học, và bài viết áp dụng vào Speaking & Writing.',
};

function Hero() {
  return (
    <div className="py-14 text-center ds-fadein">
      <div className="ds-badge ds-badge-teal mb-5">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
        IELTS Grammar Reference
      </div>
      <h1 className="hero-title text-4xl sm:text-5xl font-extrabold mb-4 leading-tight">
        Học ngữ pháp như một<br className="hidden sm:block" />
        <span
          className="text-transparent bg-clip-text"
          style={{ backgroundImage: 'linear-gradient(90deg, var(--av-primary), var(--av-skill-reading))' }}
        >
          hệ thống liên kết
        </span>
      </h1>
      <p className="text-white/50 text-lg mb-8 max-w-xl mx-auto">
        Tra cứu nhanh, học theo roadmap, ứng dụng vào IELTS Speaking &amp; Writing.
      </p>

      <SearchBox />

      <div className="flex flex-wrap gap-3 justify-center">
        <a href="#groups-section" className="btn-cta btn-primary">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          Khám phá hệ thống
        </a>
        <a href="#groups-section" className="btn-cta btn-outline">Xem 9 nhóm chủ đề</a>
        <a href="/pages/grammar-search.html?q=ielts" className="btn-cta btn-outline">Grammar cho IELTS</a>
        <a href="/pages/grammar-exercises.html" className="btn-cta btn-outline">Bài tập Grammar</a>
      </div>
    </div>
  );
}

/** Khung xương lúc chờ — giữ đúng skeleton của legacy để không nhảy layout. */
function BodySkeleton() {
  return (
    <div className="ds-fadein">
      <section className="mb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="skeleton h-56 rounded-2xl" />
          <div className="skeleton h-56 rounded-2xl" />
          <div className="skeleton h-56 rounded-2xl" />
          <div className="skeleton h-56 rounded-2xl" />
        </div>
      </section>
    </div>
  );
}

function HomeContent({ home, groups }: { home: any; groups: any[] }) {
  const complete = groups.reduce((n, g) => n + (g.complete_count || 0), 0);
  const planned = groups.reduce((n, g) => n + ((g.article_count || 0) - (g.complete_count || 0)), 0);

  return (
    <div id="home-content" className="ds-fadein">
      <section id="groups-section" className="mb-16">
        <div className="flex items-center justify-between mb-5">
          <p className="section-head">Khám phá theo nhóm chủ đề</p>
          <span className="text-xs text-white/25 hidden sm:block">
            <span id="groups-complete-count">{complete}</span> bài hoàn chỉnh ·{' '}
            <span id="groups-planned-count">{planned}</span> sắp ra mắt
          </span>
        </div>
        <div id="groups-list" className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <GroupCards groups={groups} />
        </div>
      </section>

      <section className="mb-14">
        <p className="section-head">Bài nổi bật</p>
        <div id="featured-list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeaturedCards articles={home?.featured} />
        </div>
      </section>

      <section id="categories" className="mb-14">
        <p className="section-head">Duyệt theo thư mục bài</p>
        <div id="category-cards" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CategoryCards categories={home?.categories} />
        </div>
      </section>

      <section className="mb-14">
        <p className="section-head">Roadmap học tập</p>
        <div className="roadmap-card p-6 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <div className="flex-1">
            <h3 className="font-bold text-white text-lg mb-1">Học có hệ thống theo thứ tự</h3>
            <p className="text-white/50 text-sm">
              Mỗi chủ đề có lộ trình từ kiến thức nền → nâng cao. Học theo thứ tự được đề xuất để không bỏ sót.
            </p>
          </div>
          <a href="/pages/grammar-roadmap.html?slug=tenses" className="btn-cta btn-primary flex-shrink-0">
            Bắt đầu với Tenses →
          </a>
        </div>
      </section>
    </div>
  );
}

function CategoryView({ slug, data }: { slug: string; data: any }) {
  return (
    <div id="category-view" className="ds-fadein">
      <div className="mb-6 flex items-center gap-3">
        <a href="/grammar" className="text-white/40 hover:text-white/70 text-sm transition-colors">
          ← Grammar Wiki
        </a>
        <h2 id="category-view-title" className="text-xl font-bold text-white capitalize">
          {data?.title || slug.replace(/-/g, ' ')}
        </h2>
      </div>
      <div id="category-view-list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <FeaturedCards articles={data?.articles} />
      </div>
    </div>
  );
}

/**
 * Phần đọc `searchParams` — bắt buộc nằm sau `Suspense`.
 *
 * Ba chế độ, giữ nguyên hành vi legacy (`loadGrammarHome`):
 *   `?q=`        → chuyển sang trang kết quả tìm kiếm (legacy, chưa port)
 *   `?category=` → xem một thư mục
 *   không tham số → trang chủ đầy đủ
 */
async function GrammarBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const category = typeof params.category === 'string' ? params.category : '';

  if (q) redirect(`/pages/grammar-search.html?q=${encodeURIComponent(q)}`);

  if (category) {
    const data = await getCategory(category);
    return <CategoryView slug={category} data={data} />;
  }

  // Hai lần fetch song song — legacy cũng vậy; tuần tự sẽ cộng dồn độ trễ vào
  // đúng phần đang stream.
  const [home, groups] = await Promise.all([getHome(), getGroups()]);
  return <HomeContent home={home} groups={Array.isArray(groups) ? groups : []} />;
}

export default function GrammarHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <main className="av-w-page pb-20">
      <Hero />
      <Suspense fallback={<BodySkeleton />}>
        <GrammarBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
