// Trang chủ Grammar Wiki — route Next canonical `/grammar` (Phase 3, route đầu).
//
// ĐÃ CUTOVER 2026-08-03: mọi điều hướng nội bộ (chrome, trang chủ, pricing,
// quiz, các trang Grammar legacy) nay trỏ `/grammar`. Đây là route canonical.
//
// KHÔNG redirect `/grammar.html` — cố ý. Bản legacy vẫn được phục vụ, đúng như
// pilot 2 đã làm với `/pages/grammar-article.html` (vẫn 200 tới hôm nay). Lý do
// không chỉ là tương thích bookmark: chừng nào cả hai bản còn sống thì cổng
// parity G1 còn so được. Redirect là gỡ luôn lớp bảo vệ đó. Việc gỡ bản legacy
// thuộc Phase 7, làm sau và làm có chủ đích.
//
// Khuôn PPR (cacheComponents): vỏ tĩnh prerender sẵn, phần đọc `searchParams`
// nằm SAU `Suspense`. Đây không phải lựa chọn thẩm mỹ — `searchParams` không
// được phép đọc bên trong `use cache`, mà mọi loader nội dung đều `use cache`.
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';

import {
  getHome,
  getGroups,
  getCategory,
  type GrammarCategoryWire,
  type GrammarGroupsWire,
  type GrammarHomeWire,
} from '../../../lib/grammar-api';
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { av2FontClass } from '@/styles/av2/fonts';
import { CourseLinkLine } from '@/components/library/course-link-line';
import { splitTitle } from '@/lib/grammar-index-model.mjs';
import { grammarArticleHref } from '@/lib/grammar-navigation-context.mjs';
import { FeaturedCards } from './grammar-cards';
import { GrammarIndex, type IndexView } from './grammar-index';
import { GrammarLearningDashboard, GrammarModeSwitcher } from './grammar-home-mode';
import styles from './grammar-home.module.css';

// Legacy `<title>` nguyên văn — parity tiêu đề là thứ người dùng thấy trên tab
// và Google thấy trong kết quả tìm kiếm.
export const metadata: Metadata = {
  title: 'Grammar Wiki — Aver Learning',
  description:
    'Tra cứu ngữ pháp IELTS theo hệ thống: các nhóm chủ đề, lộ trình học, và bài viết áp dụng vào Speaking & Writing.',
  alternates: { canonical: '/grammar' },
};

/** Static top of the page: in the prerendered shell, before any data. */
function Hero() {
  return (
    <header>
      <nav aria-label="Vị trí trang" className={styles.crumbs}>
        <a href="/library">Thư viện</a> › <span aria-current="page">Grammar Wiki</span>
      </nav>
      <p className={styles.eyebrow}>Thư viện · Ngữ pháp</p>
      <h1>Grammar Wiki</h1>
      <p className={styles.lead}>
        Tra cứu ngữ pháp tiếng Anh theo hệ thống. Mỗi bài giảng bằng tiếng Việt, ví dụ tiếng Anh. Đọc miễn phí, không cần
        tài khoản.
      </p>
    </header>
  );
}

/** While the index loads: keeps the place of the index, never a fake count. */
function BodySkeleton() {
  return (
    <p className={styles.hint} aria-busy="true" data-testid="grammar-home-loading">
      Đang tải mục lục…
    </p>
  );
}

type Featured = NonNullable<GrammarHomeWire['featured_articles']>;

/** "Bài nổi bật" from the API's `featured_articles`. */
function FeaturedList({ articles }: { articles?: Featured }) {
  const items = (articles ?? []).filter((a) => a?.slug && a?.category).slice(0, 6);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="featured-title" className={styles.featured}>
      <h2 id="featured-title">Bài nổi bật</h2>
      <ol className={styles.featuredList}>
        {items.map((a) => {
          const { en, vi } = splitTitle(a.title);
          return (
            <li key={a.slug}>
              <a href={grammarArticleHref(a.category, a.slug)} className={styles.articleEn} lang="en">
                {en}
              </a>
              {vi ? <span className={styles.articleVi}>{vi}</span> : null}
              {a.summary ? <span className={styles.featuredSummary}>{a.summary}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function HomeContent({
  home,
  groups,
  view,
  group,
}: {
  home: GrammarHomeWire | null;
  groups: GrammarGroupsWire;
  view: IndexView;
  group: string;
}) {
  return (
    <div id="home-content">
      <GrammarModeSwitcher
        reference={
          <GrammarIndex groups={groups} initialView={view} initialGroup={group}>
            <FeaturedList articles={home?.featured_articles} />
          </GrammarIndex>
        }
        learning={<>
          <section className="mb-10"><p className="section-head">Không học lại từ đầu — học đúng chỗ cần</p><GrammarLearningDashboard /></section>
          <section className="gw-learning-actions"><Link href="/grammar/roadmap"><span>01</span><strong>Lộ trình</strong><small>Xem thứ tự nền tảng → điểm yếu</small></Link><Link href="/grammar/exercises"><span>02</span><strong>Bài luyện</strong><small>Lọc theo chủ đề và trình độ</small></Link><Link href="/grammar/search?q=ielts"><span>03</span><strong>IELTS transfer</strong><small>Tìm bài dùng cho kỹ năng cụ thể</small></Link></section>
        </>}
      />
    </div>
  );
}

function CategoryView({ slug, data }: { slug: string; data: GrammarCategoryWire }) {
  return (
    <div id="category-view" className="ds-fadein">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/grammar" className="text-white/40 hover:text-white/70 text-sm transition-colors">
          ← Grammar Wiki
        </Link>
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
 *   không tham số → trang chủ đầy đủ (`?xem=az` · `?nhom=<nhóm>` chọn cách xếp mục lục)
 */
async function GrammarBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The route-manifest CI build intentionally has no backend. Defer canonical
  // Grammar reads to a real request while preserving the prerendered shell.
  await connection();
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const category = typeof params.category === 'string' ? params.category : '';
  const view: IndexView = params.xem === 'az' ? 'az' : 'groups';
  const group = typeof params.nhom === 'string' ? params.nhom : '';

  if (q) redirect(`/grammar/search?q=${encodeURIComponent(q)}`);

  if (category) {
    const data = await getCategory(category);
    // `getPublicJson` biến 404 của backend thành `null`. Render tiếp với `null`
    // sẽ BỊA ra một thư mục rỗng mang tên lấy từ slug — link hỏng/cũ trông như
    // thư mục hợp lệ chưa có bài. Trả 404 thật để hỏng thì lộ ra.
    if (!data) notFound();
    return <CategoryView slug={category} data={data} />;
  }

  // Hai lần fetch song song — legacy cũng vậy; tuần tự sẽ cộng dồn độ trễ vào
  // đúng phần đang stream.
  const [home, groups] = await Promise.all([getHome(), getGroups()]);
  return <HomeContent home={home} groups={groups || []} view={view} group={group} />;
}

export default function GrammarHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      {/* Chrome chung (Sprint 7.13). Layout chỉ NẠP script; phần tử phải do
          từng trang dựng — legacy `grammar.html` và route bài viết đều có
          dòng này. Thiếu nó thì trang mất toàn bộ điều hướng + khối tài khoản
          mà build vẫn xanh. */}
      {/* @ts-ignore */}
      <aver-chrome active="grammar" />

      {/* T014 (b): the home body is on the "Bản in" tokens; the layout keeps the
          legacy chrome and cascade until part (c) moves the whole group. */}
      <div className={`av2-root ${av2FontClass}`}>
        <main className={styles.home}>
          <Hero />
          <Suspense fallback={<BodySkeleton />}>
            <GrammarBody searchParams={searchParams} />
          </Suspense>
          <CourseLinkLine href="/" linkLabel="Xem các khoá học">
            Muốn học theo thứ tự? Wiki để tra cứu; khoá học sắp các điểm ngữ pháp theo thứ tự học, có bài tập sau mỗi bài.
          </CourseLinkLine>
        </main>
      </div>
    </>
  );
}
