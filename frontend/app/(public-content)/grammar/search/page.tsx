/**
 * Grammar search — `/grammar/search` (LIBRARY-0061 T014 PR (c), FR-040).
 * Same URL, same `q`/`level`/`use` query and the same server-side filtering;
 * only the frame changes ("Bản in"). The query string stays the single source
 * of truth: the form is a plain GET, so Back/Forward and shared links rebuild
 * the same results on the server.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { Button, Select, TextField } from '@/components/ui';
import { getSearch, type GrammarSearchWire } from '@/lib/grammar-api';
import { articleUrl } from '../grammar-cards';
import { SubpageFrame, SubpageHeader, SubpageSkeleton, articleMeta, frameStyles as styles } from '../subpage-frame';

export const metadata: Metadata = {
  title: 'Tìm kiếm — Grammar Wiki — Aver Learning',
  robots: { index: false, follow: true },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type SearchArticle = GrammarSearchWire[number];

const LEVEL_OPTIONS = [
  { value: '', label: 'Tất cả' },
  { value: 'beginner', label: 'Cơ bản' },
  { value: 'intermediate', label: 'Trung cấp' },
  { value: 'advanced', label: 'Nâng cao' },
] as const;

const USE_OPTIONS = [
  { value: '', label: 'Tất cả' },
  { value: 'speaking', label: 'Speaking' },
  { value: 'writing', label: 'Writing' },
  { value: 'reading', label: 'Reading' },
] as const;

const SUGGESTIONS = [
  { q: 'present perfect', label: 'present perfect' },
  { q: 'conditionals', label: 'conditionals' },
  { q: 'passive', label: 'passive voice' },
];

function matchesUse(article: SearchArticle, use: string) {
  if (!use) return true;
  if (use === 'speaking') return article.speaking_relevance === 'high';
  if (use === 'writing') return article.writing_relevance === 'high' || article.category === 'grammar-for-writing';
  if (use === 'reading') return article.category === 'grammar-for-reading';
  return true;
}

function ResultsSkeleton() {
  return <SubpageSkeleton id="search-skeleton" rows={4} />;
}

function NoResults({ query }: { query: string }) {
  return (
    <div className={styles.empty}>
      <p className={styles.itemText}>Không tìm thấy kết quả cho &quot;<strong>{query}</strong>&quot;.</p>
      <p className={styles.itemMeta}>
        Thử từ khóa khác:{' '}
        {SUGGESTIONS.map((s, i) => (
          <span key={s.q}>
            {i ? ', ' : null}
            <Link href={`/grammar/search?q=${encodeURIComponent(s.q)}`}>{s.label}</Link>
          </span>
        ))}
      </p>
    </div>
  );
}

function ResultList({ articles, query }: { articles: GrammarSearchWire; query: string }) {
  const list = articles.filter((a) => a && a.slug && a.title && a.category);
  if (!list.length) return <NoResults query={query} />;
  return (
    <ul className={styles.list}>
      {list.map((article) => (
        <li key={`${article.category}/${article.slug}`} className={styles.item}>
          <h2 className={styles.itemTitle}>
            <Link href={articleUrl(article.category, article.slug)}>{article.title}</Link>
            {article.status === 'updating' ? <span className={styles.tag}>Đang cập nhật</span> : null}
          </h2>
          <p className={styles.itemMeta}>{articleMeta(article)}</p>
          {article.summary ? <p className={styles.itemText}>{article.summary}</p> : null}
        </li>
      ))}
    </ul>
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
  const articles: GrammarSearchWire = (results || []).filter((article) => {
    const levelMatches = !level || article.level?.toLowerCase() === level;
    return levelMatches && matchesUse(article, use);
  });

  return (
    <main id="search-container" tabIndex={-1} className={`${styles.main} ${styles.narrow}`}>
      <SubpageHeader
        title={query ? `Kết quả cho "${query}"` : 'Tìm kiếm Grammar'}
        titleId="search-heading"
      />

      <form method="get" action="/grammar/search" role="search" className={styles.filters} aria-label="Tìm và lọc bài Grammar">
        <TextField
          label="Từ khoá"
          name="q"
          id="search-input"
          defaultValue={raw}
          placeholder="present perfect, mạo từ…"
          className={styles.filterWide}
        />
        <Select label="Trình độ" name="level" defaultValue={level} options={LEVEL_OPTIONS} className={styles.filterField} />
        <Select label="Mục tiêu" name="use" defaultValue={use} options={USE_OPTIONS} className={styles.filterField} />
        <div className={styles.filterActions}>
          <Button type="submit" variant="secondary">Tìm</Button>
          {(level || use) ? <Link href={`/grammar/search?q=${encodeURIComponent(query)}`}>Xóa bộ lọc</Link> : null}
        </div>
      </form>

      <p id="search-count" className={styles.count} aria-live="polite">
        {articles.length ? `${articles.length} kết quả` : ''}
      </p>
      <div id="search-results-list">
        {query
          ? <ResultList articles={articles} query={query} />
          : <p className={styles.empty}>Nhập từ khóa để tìm kiếm.</p>}
      </div>
    </main>
  );
}

export default function GrammarSearchPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SubpageFrame crumbs={[{ label: 'Tìm kiếm' }]}>
      <Suspense fallback={<ResultsSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </SubpageFrame>
  );
}
