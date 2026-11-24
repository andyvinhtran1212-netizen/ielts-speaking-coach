import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';

import { getCompare, type GrammarCompareWire } from '@/lib/grammar-api';
import { articleUrl } from '../grammar-cards';
import { SubpageFrame, SubpageHeader, SubpageSkeleton, articleMeta, frameStyles as styles } from '../subpage-frame';
import { redirectNoticeHref } from '@/lib/redirect-notice-model.mjs';

type CompareArticle = GrammarCompareWire['left'];
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function querySlug(params: Record<string, string | string[] | undefined>) {
  return typeof params.slug === 'string' ? params.slug.trim() : '';
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const slug = querySlug(await searchParams);
  if (!slug) return { title: 'So sánh — Grammar Wiki — Aver Learning', robots: { index: false, follow: true } };
  const data = await getCompare(slug);
  if (!data) notFound();
  return { title: `${data.left.title} vs ${data.right.title} — Grammar Wiki`, robots: { index: false, follow: true } };
}

function CompareSkeleton() {
  return <SubpageSkeleton id="compare-skeleton" rows={4} />;
}

function CompareColumn({ article, id }: { article: CompareArticle; id: string }) {
  return (
    <section id={id} className={styles.compareCol} aria-labelledby={`${id}-title`}>
      <p className={styles.itemMeta}>{articleMeta(article)}</p>
      <h2 id={`${id}-title`} className={styles.colTitle}>{article.title}</h2>
      {article.summary ? <p className={styles.itemText}>{article.summary}</p> : null}
      <Link href={articleUrl(article.category, article.slug)} className={styles.colLink}>
        Đọc bài đầy đủ ›
      </Link>
      {/* Authored Markdown HTML from GrammarContentService, as on the article
          page; title/summary above stay React-escaped, so the trust boundary
          does not widen to other fields. */}
      <div className="article-body" dangerouslySetInnerHTML={{ __html: article.html || '' }} />
    </section>
  );
}

async function CompareBody({ searchParams }: { searchParams: SearchParams }) {
  const slug = querySlug(await searchParams);
  // G02-T11: a compare link without its slug goes back to the Wiki with a
  // notice. Inside this async child (rendered under <Suspense>), as the
  // cacheComponents build requires for request data.
  if (!slug) redirect(redirectNoticeHref('/grammar'));

  const data = await getCompare(slug);
  if (!data) notFound();

  return (
    <main id="compare-container" tabIndex={-1} className={styles.main}>
      <SubpageHeader
        eyebrow="Grammar Wiki · So sánh"
        titleId="compare-title"
        title={<>{data.left.title}<span className={styles.vs}>vs</span>{data.right.title}</>}
      />
      <div className={styles.compare}>
        <CompareColumn article={data.left} id="compare-left" />
        <CompareColumn article={data.right} id="compare-right" />
      </div>
    </main>
  );
}

export default function GrammarComparePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SubpageFrame crumbs={[{ label: 'So sánh' }]}>
      <Suspense fallback={<CompareSkeleton />}>
        <CompareBody searchParams={searchParams} />
      </Suspense>
    </SubpageFrame>
  );
}
