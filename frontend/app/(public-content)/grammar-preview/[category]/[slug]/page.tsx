// Pilot 2 — public grammar article, dark-launched at
// /grammar-preview/[category]/[slug] (plan Phase 2). The canonical
// /grammar/:category/:slug stays legacy-owned until its atomic cutover
// (route-ownership check enforces the pairing).
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
  // notFound() HERE (before the response starts streaming) so the missing
  // article is a REAL HTTP 404 — thrown in the page body it would be a
  // soft-404 (200 + shell already committed under PPR).
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
