import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { getVocabularyArticle, getVocabularyCategories } from '@/lib/vocabulary-api';
import { normalizeVocabularyArticle, normalizeVocabularyCategories, resolveVocabularySelection } from '@/lib/vocabulary-model.mjs';
import { VocabularyWiki } from './vocabulary-wiki';

export const metadata: Metadata = {
  title: 'Vocabulary Wiki — Aver Learning',
  description: 'Tra cứu từ vựng IELTS theo chủ đề, phát âm, cách dùng, collocation và lỗi thường gặp.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function queryText(value: string | string[] | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

async function VocabularyBody({ searchParams }: { searchParams: SearchParams }) {
  // The generic build/ownership job intentionally has no backend configured.
  // Keep the static shell + Suspense fallback prerenderable, but defer the
  // canonical category read to a real request instead of making `next build`
  // depend on localhost:8000 (or on production network availability).
  await connection();
  const [params, categoriesPayload] = await Promise.all([searchParams, getVocabularyCategories()]);
  const categories = normalizeVocabularyCategories(categoriesPayload) as any[];
  const words = categories.flatMap((category) => category.articles);
  const requestedCategory = queryText(params.cat);
  const requestedSlug = queryText(params.slug);
  const selected = resolveVocabularySelection(words, requestedCategory, requestedSlug);
  const articlePayload = selected ? await getVocabularyArticle(selected.category, selected.slug) : null;
  const initialArticle = articlePayload && selected
    ? normalizeVocabularyArticle(articlePayload, selected.category, selected.slug)
    : null;
  return <VocabularyWiki categories={categories} initialArticle={initialArticle as any} initialCategory={requestedCategory} initialSlug={requestedSlug} />;
}

function VocabularySkeleton() {
  return <div className="vmd-shell"><aside className="vmd-list"><p className="va-empty">Đang tải từ vựng…</p></aside><section className="vmd-detail"><p className="va-empty">Đang tải…</p></section></div>;
}

export default function VocabularyPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      {/* @ts-ignore custom element được đăng ký bởi public-content layout */}
      <aver-chrome active="vocabulary" />
      <Suspense fallback={<VocabularySkeleton />}><VocabularyBody searchParams={searchParams} /></Suspense>
    </>
  );
}
