// Public grammar content loader — pilot 2 (plan Phase 2 / ADR-008).
//
// `server-only`: this module must never reach a client bundle; it holds no
// secrets (public GET endpoints only, no cookies/Authorization — ADR-004),
// but the boundary is the contract (B25).
//
// Environment resolution mirrors the runtime-config generator (ADR-006):
// production build → production API; any other Vercel env → STAGING; local
// dev → localhost. AVER_API_BASE overrides per-field, same as the generator.
import 'server-only';

import { cache } from 'react';
import { cacheLife } from 'next/cache';

const API_BASE =
  process.env.AVER_API_BASE ||
  (process.env.VERCEL_ENV === 'production'
    ? 'https://ielts-speaking-coach-production.up.railway.app'
    : process.env.VERCEL_ENV
      ? 'https://ielts-speaking-coach-staging.up.railway.app'
      : 'http://localhost:8000');

async function fetchArticle(category: string, slug: string): Promise<any | null> {
  'use cache';
  // ADR-008: 1h TTL, serve-stale while revalidating, hard expire 1 day.
  cacheLife({ stale: 3600, revalidate: 3600, expire: 86400 });

  const res = await fetch(
    `${API_BASE}/api/grammar/article/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
    { signal: AbortSignal.timeout(5000) }, // ADR-008 abort budget
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    // Upstream failure → throw: the route's error boundary is the plain
    // fail-closed fallback (B17/B12); the request-time cache may still serve
    // a previous good entry within its stale window.
    throw new Error(`grammar api ${res.status} for ${category}/${slug}`);
  }
  return res.json();
}

// React cache(): generateMetadata + the page body share ONE fetch per request
// (ADR-008: "generateMetadata và page body phải dùng cùng memoized loader").
export const getArticle = cache(fetchArticle);
