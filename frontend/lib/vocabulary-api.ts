import 'server-only';

import { cache } from 'react';

import { getPublicJson } from './backend';

export const VOCABULARY_DIRECTORY_PAGE_SIZE = 60;

async function fetchCategories(): Promise<unknown | null> {
  return getPublicJson('/api/vocabulary/categories');
}

async function fetchArticle(category: string, slug: string): Promise<unknown | null> {
  return getPublicJson(
    `/api/vocabulary/articles/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
  );
}

async function fetchDirectory({
  category = '',
  query = '',
  offset = 0,
  limit = VOCABULARY_DIRECTORY_PAGE_SIZE,
}: {
  category?: string;
  query?: string;
  offset?: number;
  limit?: number;
} = {}): Promise<unknown | null> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  if (category) params.set('category', category);
  if (query) params.set('q', query);
  return getPublicJson(`/api/vocabulary/directory?${params.toString()}`);
}

export const getVocabularyCategories = cache(fetchCategories);
export const getVocabularyArticle = cache(fetchArticle);
export const getVocabularyDirectory = cache(fetchDirectory);
