// Public grammar content loader — pilot 2 (plan Phase 2 / ADR-008), nay dùng
// chung tầng `lib/backend.ts` với các route Phase 3 khác.
//
// Trước đây file này tự giữ resolve-base + fetch + cacheLife riêng. Đã rút hết
// sang `lib/backend.ts` để route mới không phải chép lại — và để khi cần đổi
// ngân sách abort hay TTL thì chỉ có MỘT chỗ phải đổi.
import 'server-only';

import { cache } from 'react';
import { getPublicJson } from './backend';
import type { ApiGetJson } from './openapi-contract';

export type GrammarHomeWire = ApiGetJson<'/api/grammar/home'>;
export type GrammarCategoryWire = ApiGetJson<'/api/grammar/category/{slug}'>;
export type GrammarArticleWire = ApiGetJson<'/api/grammar/article/{category}/{slug}'>;
export type GrammarSearchWire = ApiGetJson<'/api/grammar/search'>;
export type GrammarCompareWire = ApiGetJson<'/api/grammar/compare/{slug}'>;
export type GrammarRoadmapWire = ApiGetJson<'/api/grammar/roadmap/{slug}'>;
export type GrammarGroupsWire = ApiGetJson<'/api/grammar/groups'>;

/** Bài viết theo `category/slug`; `null` = không có bài (route sẽ notFound). */
async function fetchArticle(category: string, slug: string): Promise<GrammarArticleWire | null> {
  return getPublicJson<GrammarArticleWire>(
    `/api/grammar/article/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
  );
}

/** Dữ liệu trang chủ Grammar: toàn bộ category + tối đa 6 bài nổi bật. */
async function fetchHome(): Promise<GrammarHomeWire | null> {
  return getPublicJson<GrammarHomeWire>('/api/grammar/home');
}

/** Các nhóm chủ đề + trạng thái từng bài trong nhóm. */
async function fetchGroups(): Promise<GrammarGroupsWire | null> {
  return getPublicJson<GrammarGroupsWire>('/api/grammar/groups');
}

/** Một thư mục + danh sách bài của nó (chế độ `?category=` của trang chủ). */
async function fetchCategory(slug: string): Promise<GrammarCategoryWire | null> {
  return getPublicJson<GrammarCategoryWire>(`/api/grammar/category/${encodeURIComponent(slug)}`);
}

/** Tìm tối đa 20 bài theo hợp đồng public `/api/grammar/search`. */
async function fetchSearch(query: string): Promise<GrammarSearchWire | null> {
  return getPublicJson<GrammarSearchWire>(`/api/grammar/search?q=${encodeURIComponent(query)}`);
}

/** Hai bài viết đầy đủ cho route so sánh `<left>-vs-<right>`. */
async function fetchCompare(slug: string): Promise<GrammarCompareWire | null> {
  return getPublicJson<GrammarCompareWire>(`/api/grammar/compare/${encodeURIComponent(slug)}`);
}

/** Lộ trình bài viết của một category công khai. */
async function fetchRoadmap(slug: string): Promise<GrammarRoadmapWire | null> {
  return getPublicJson<GrammarRoadmapWire>(`/api/grammar/roadmap/${encodeURIComponent(slug)}`);
}

// React `cache()`: generateMetadata và thân trang dùng CHUNG một lần fetch cho
// mỗi request (ADR-008: "generateMetadata và page body phải dùng cùng memoized
// loader"). Loader mới cũng phải đi qua đây, không gọi thẳng backend.
export const getArticle = cache(fetchArticle);
export const getHome = cache(fetchHome);
export const getGroups = cache(fetchGroups);
export const getCategory = cache(fetchCategory);
export const getSearch = cache(fetchSearch);
export const getCompare = cache(fetchCompare);
export const getRoadmap = cache(fetchRoadmap);
