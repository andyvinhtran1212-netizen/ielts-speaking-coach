import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getRoadmap, type GrammarRoadmapWire } from '@/lib/grammar-api';
import { normalizePublicRoadmap } from '@/lib/public-roadmap-model.mjs';
import { articleUrl, type Article } from '../grammar-cards';
import { SubpageFrame, SubpageHeader, SubpageSkeleton, categoryLabel, levelLabel, frameStyles as styles } from '../subpage-frame';
import { PersonalRoadmap } from './personal-roadmap';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function querySlug(params: Record<string, string | string[] | undefined>) {
  return typeof params.slug === 'string' ? params.slug.trim() : '';
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const slug = querySlug(await searchParams);
  if (!slug) return { title: 'Lộ trình của bạn — Grammar Wiki', robots: { index: false, follow: true } };
  const data = await getRoadmap(slug);
  if (!data) notFound();
  const roadmap = normalizePublicRoadmap(data) as { title: string };
  return { title: `${roadmap.title} — Lộ trình học — Grammar Wiki`, robots: { index: false, follow: true } };
}

function RoadmapSkeleton() {
  return <SubpageFrame crumbs={[{ label: 'Lộ trình' }]}><SubpageSkeleton id="roadmap-skeleton" rows={3} /></SubpageFrame>;
}

function RoadmapSteps({ articles }: { articles: Article[] }) {
  if (!articles.length) return <p className={styles.empty}>Chưa có bài nào trong lộ trình này.</p>;
  return (
    <ol className={styles.steps}>
      {articles.map((article, index) => {
        const updating = article.status === 'updating';
        const level = levelLabel(article.level);
        return (
          <li className={styles.step} key={`${article.category}/${article.slug}`}>
            <span className={styles.stepNum} aria-hidden="true">{index + 1}</span>
            <div className={styles.stepBody}>
              <h2 className={styles.itemTitle}>
                {updating
                  ? <>{article.title}<span className={styles.tag}>Sắp ra mắt</span></>
                  : <Link href={articleUrl(article.category, article.slug)}>{article.title}</Link>}
              </h2>
              <p className={styles.itemMeta}>{[`Bước ${index + 1}`, level, `${article.reading_time || 1} phút`].filter(Boolean).join(' · ')}</p>
              {article.summary ? <p className={styles.itemText}>{article.summary}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

async function RoadmapBody({ searchParams }: { searchParams: SearchParams }) {
  const slug = querySlug(await searchParams);
  if (!slug) return <PersonalRoadmap />;
  const data: GrammarRoadmapWire | null = await getRoadmap(slug);
  if (!data) notFound();
  const roadmap = normalizePublicRoadmap(data) as { title: string; articles: Article[] };
  const { articles, title } = roadmap;
  const groupLabel = title || categoryLabel(slug);
  return (
    <SubpageFrame crumbs={[{ label: groupLabel, href: `/grammar?category=${encodeURIComponent(slug)}` }, { label: 'Lộ trình' }]}>
      <main id="roadmap-container" tabIndex={-1} className={`${styles.main} ${styles.narrow}`}>
        <SubpageHeader
          eyebrow="Grammar Wiki · Lộ trình"
          title={`Lộ trình: ${title}`}
          titleId="roadmap-title"
          intro={`${articles.length} bài học theo thứ tự từ cơ bản đến nâng cao`}
          introId="roadmap-subtitle"
        />
        <div id="roadmap-steps"><RoadmapSteps articles={articles} /></div>
        <p className={styles.footer}>
          <Link id="roadmap-cat-link" href={`/grammar?category=${encodeURIComponent(slug)}`}>Xem tất cả bài {title} ›</Link>
        </p>
      </main>
    </SubpageFrame>
  );
}

export default function GrammarRoadmapPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<RoadmapSkeleton />}>
      <RoadmapBody searchParams={searchParams} />
    </Suspense>
  );
}
