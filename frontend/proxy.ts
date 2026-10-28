// Real HTTP 404 for unknown Grammar articles (content audit 2026-10-27).
//
// Under cacheComponents the article route serves its App Shell (loading.tsx)
// before the article fetch resolves, so `notFound()` in the page can only
// produce a soft 404: HTTP 200 + noindex (see generateMetadata in
// app/(public-content)/grammar/[category]/[slug]/page.tsx). Next 16 decides a
// real status only before rendering starts, i.e. here. A key missing from a
// fresh backend article list is rewritten to a prerendered 404 that renders
// inside the Grammar layout; everything else (known article, list
// unavailable) passes through unchanged.
import { NextResponse, type NextRequest } from 'next/server';

import { API_BASE } from '@/lib/backend';
import { articleKeys, createArticleIndex } from '@/lib/grammar-article-index.mjs';

const GRAMMAR_ARTICLE_NOT_FOUND_PATH = '/grammar/article-not-found';

// Shorter than ABORT_MS: a slow list must not hold every article request.
const INDEX_TIMEOUT_MS = 2000;

const articleIndex = createArticleIndex({
  async load() {
    const res = await fetch(`${API_BASE}/api/grammar/categories`, {
      signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`backend ${res.status} for /api/grammar/categories`);
    return articleKeys(await res.json());
  },
});

function segment(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const [, , rawCategory = '', rawSlug = ''] = request.nextUrl.pathname.split('/');
  const category = segment(rawCategory);
  const slug = segment(rawSlug);
  // A segment that is not valid percent-encoding cannot name an article (the
  // route itself would answer 500 while decoding params).
  const missing = category === null || slug === null
    || (await articleIndex.has(category, slug)) === false;
  return missing
    ? NextResponse.rewrite(new URL(GRAMMAR_ARTICLE_NOT_FOUND_PATH, request.url))
    : NextResponse.next();
}

export const config = {
  matcher: '/grammar/:category/:slug',
};
