import 'server-only';

import { cache } from 'react';

import { getPublicJson } from './backend';
import type { VocabularyDirectoryWire } from './vocabulary-types';

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
} = {}): Promise<VocabularyDirectoryWire | null> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  if (category) params.set('category', category);
  if (query) params.set('q', query);
  return getPublicJson<VocabularyDirectoryWire>(`/api/vocabulary/directory?${params.toString()}`);
}

export const getVocabularyCategories = cache(fetchCategories);
export const getVocabularyArticle = cache(fetchArticle);
export const getVocabularyDirectory = cache(fetchDirectory);

/**
 * Every directory word (LIBRARY-0061 T015: "Kết quả tra" and near-word
 * suggestions run over the full list). The directory caps a page at 100, so
 * this reads page by page; each page is the same cached public read as above.
 * A failed page returns what was read so far.
 */
async function fetchAllWords(): Promise<VocabularyDirectoryWire['items']> {
  const items: VocabularyDirectoryWire['items'] = [];
  for (let page = 0; page < 40; page += 1) {
    const result = await getVocabularyDirectory({ offset: items.length, limit: 100 }).catch(() => null);
    if (!result?.items?.length) break;
    items.push(...result.items);
    if (items.length >= result.total) break;
  }
  return items;
}

export const getAllVocabularyWords = cache(fetchAllWords);
