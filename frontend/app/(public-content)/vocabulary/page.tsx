import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { getVocabularyArticle, getVocabularyCategories, getVocabularyDirectory } from '@/lib/vocabulary-api';
import { normalizeVocabularyArticle, normalizeVocabularyCategories, normalizeVocabularyDirectory, resolveVocabularySelection } from '@/lib/vocabulary-model.mjs';
import type { VocabularyArticle, VocabularyDirectory } from '@/lib/vocabulary-types';
import { VocabularyWiki } from './vocabulary-wiki';

export const metadata: Metadata = {
  title: 'Vocabulary Wiki — Aver Learning',
  description: 'Tra cứu từ vựng IELTS theo chủ đề, phát âm, cách dùng, collocation và lỗi thường gặp.',
  alternates: { canonical: '/vocabulary' },
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
  const params = await searchParams;
  const requestedCategory = queryText(params.cat);
  const requestedSlug = queryText(params.slug);
  let effectiveCategory = requestedCategory;
  let directoryPayload = await getVocabularyDirectory({ category: effectiveCategory });
  let directory = normalizeVocabularyDirectory(directoryPayload) as VocabularyDirectory;
  if (effectiveCategory && !directory.categories.some((category) => category.slug === effectiveCategory)) {
    effectiveCategory = '';
    directoryPayload = await getVocabularyDirectory();
    directory = normalizeVocabularyDirectory(directoryPayload) as VocabularyDirectory;
  }

  // Canonical links always carry the compound category + slug identity. Keep
  // the historical slug-only fallback server-side so that compatibility does
  // not force the complete catalogue into the client RSC payload.
  let selected = effectiveCategory && requestedSlug
    ? { category: effectiveCategory, slug: requestedSlug }
    : !requestedSlug
      ? directory.items[0] ?? null
      : null;
  if (!effectiveCategory && requestedSlug) {
    const categories = normalizeVocabularyCategories(await getVocabularyCategories());
    selected = resolveVocabularySelection(
      categories.flatMap((category) => category.articles),
      '',
      requestedSlug,
    );
  }
  const articlePayload = selected
    ? await getVocabularyArticle(selected.category, selected.slug)
    : null;
  const initialArticle = articlePayload && selected
    ? normalizeVocabularyArticle(articlePayload, selected.category, selected.slug) as VocabularyArticle
    : null;
  return <VocabularyWiki directory={directory} initialArticle={initialArticle} initialCategory={effectiveCategory} initialSlug={requestedSlug} />;
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
