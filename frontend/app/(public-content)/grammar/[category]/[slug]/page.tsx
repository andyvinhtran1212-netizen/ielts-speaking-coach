// Pilot 2 — public grammar article. CUTOVER (prep): canonical
// /grammar/:category/:slug is now this Next app route; the legacy rewrite
// was removed atomically in the same change (route-ownership check enforces
// the pairing).
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { getArticle } from '@/lib/grammar-api';
import { ArticleShell } from './page-shell';
import { ArticleBehavior } from './article-behavior';

// ADR-008 §3: this route's uncached SSR fetch hits the FastAPI backend on
// Railway in Singapore (x-railway-edge: sin1), so the Vercel function must run
// in Singapore too (else the default US-East region makes every uncached
// render a cross-Pacific round-trip). The function region is set project-wide
// in vercel.json `regions: ["sin1"]` — NOT via `preferredRegion` here, which
// is an EDGE-runtime-only segment config (ignored on this Node route; review
// #757). sin1 is optimal for both the backend AND the users (Vietnam ≈ 30ms).

type Params = { params: Promise<{ category: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { category, slug } = await params;
  const article = await getArticle(category, slug);
  // notFound() HERE, in metadata, is what makes a missing article carry
  // `robots: noindex` + the 404 body.
  //
  // MEASURED ON PRODUCTION 2026-07-28 (do NOT re-promise a hard 404 here):
  // under cacheComponents/PPR this route answers **HTTP 200** for every
  // missing article — the prerendered shell is served from cache
  // (`x-nextjs-prerender: 1`) before this ever runs, so the status is already
  // committed. Verified identical for a bad slug AND a bad category; there is
  // no category-dependent path (get_article() returns None for both).
  // The contract we DO hold: 404 body + noindex, so nothing gets indexed.
  // Legacy served the same case as 200 WITHOUT noindex, so this is strictly
  // better — but it is not a hard 404.
  if (!article) notFound();
  // Byte-faithful to the legacy client-side SEO block (grammar.js):
  //   title = `${article.title} — IELTS Grammar | Aver Learning`
  //   desc  = `Học ${article.title} để cải thiện ...`
  return {
    title: `${article.title} — IELTS Grammar | Aver Learning`,
    description:
      `Học ${article.title} để cải thiện IELTS Speaking và Writing. ` +
      'Ví dụ thực tế, bài tập, và lời giải thích dễ hiểu.',
  };
}

export default async function GrammarArticlePage({ params }: Params) {
  const { category, slug } = await params;
  const article = await getArticle(category, slug); // memoized — same fetch as metadata
  if (!article) notFound();

  return (
    <>
      <ArticleShell article={article} />
      <ArticleBehavior
        slug={article.slug}
        category={article.category}
        articleTitle={article.title}
        hasTOC={Boolean(article.toc && article.toc.length)}
        hasCompareWith={Boolean(article.compare_with && article.compare_with.length)}
        hasNextArticles={Boolean(article.next_articles && article.next_articles.length)}
      />
    </>
  );
}
