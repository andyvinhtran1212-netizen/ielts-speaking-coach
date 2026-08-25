// Public grammar content loader — pilot 2 (plan Phase 2 / ADR-008), nay dùng
// chung tầng `lib/backend.ts` với các route Phase 3 khác.
//
// Trước đây file này tự giữ resolve-base + fetch + cacheLife riêng. Đã rút hết
// sang `lib/backend.ts` để route mới không phải chép lại — và để khi cần đổi
// ngân sách abort hay TTL thì chỉ có MỘT chỗ phải đổi.
import 'server-only';

import { cache } from 'react';
import { getPublicJson } from './backend';

/** Bài viết theo `category/slug`; `null` = không có bài (route sẽ notFound). */
async function fetchArticle(category: string, slug: string): Promise<any | null> {
  return getPublicJson(
    `/api/grammar/article/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
  );
}

/** Dữ liệu trang chủ Grammar: toàn bộ category + tối đa 6 bài nổi bật. */
async function fetchHome(): Promise<any | null> {
  return getPublicJson('/api/grammar/home');
}

/** Các nhóm chủ đề + trạng thái từng bài trong nhóm. */
async function fetchGroups(): Promise<any | null> {
  return getPublicJson('/api/grammar/groups');
}

/** Một thư mục + danh sách bài của nó (chế độ `?category=` của trang chủ). */
async function fetchCategory(slug: string): Promise<any | null> {
  return getPublicJson(`/api/grammar/category/${encodeURIComponent(slug)}`);
}

// React `cache()`: generateMetadata và thân trang dùng CHUNG một lần fetch cho
// mỗi request (ADR-008: "generateMetadata và page body phải dùng cùng memoized
// loader"). Loader mới cũng phải đi qua đây, không gọi thẳng backend.
export const getArticle = cache(fetchArticle);
export const getHome = cache(fetchHome);
export const getGroups = cache(fetchGroups);
export const getCategory = cache(fetchCategory);
