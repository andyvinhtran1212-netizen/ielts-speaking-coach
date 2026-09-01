import 'server-only';

import { cache } from 'react';

import { getPublicJson } from './backend';

async function fetchCategories(): Promise<unknown | null> {
  return getPublicJson('/api/vocabulary/categories');
}

async function fetchArticle(category: string, slug: string): Promise<unknown | null> {
  return getPublicJson(
    `/api/vocabulary/articles/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
  );
}

export const getVocabularyCategories = cache(fetchCategories);
export const getVocabularyArticle = cache(fetchArticle);
