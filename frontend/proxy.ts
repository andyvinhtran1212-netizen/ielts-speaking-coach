// Two request-time jobs that Next 16 can only do before rendering starts.
//
// 1. Real HTTP 404 for unknown Grammar articles (content audit 2026-10-27).
//    Under cacheComponents the article route serves its App Shell
//    (loading.tsx) before the article fetch resolves, so `notFound()` in the
//    page can only produce a soft 404: HTTP 200 + noindex (see
//    generateMetadata in app/(public-content)/grammar/[category]/[slug]/page.tsx).
//    A key missing from a fresh backend article list is rewritten to a path
//    no route matches, so Next serves the root 404 (app/not-found.tsx) with
//    its full server HTML; everything else (known article, list unavailable)
//    passes through unchanged.
//
// 2. SEC-CSP-NONCE: a per-request nonce for the AuthedShell route groups.
//    Step 2 may enforce it on staging/previews only. Setting the blocking
//    response header also supplies the nonce to Vercel's PPR resume render;
//    Report-Only alone cannot do that (SA-1029-CSP1). Public and production
//    routes retain the baseline from next.config.ts. See the CSP runbook.
import { NextResponse, type NextRequest } from 'next/server';

import { API_BASE } from '@/lib/backend';
import { articleKeys, createArticleIndex } from '@/lib/grammar-article-index.mjs';
import {
  buildNonceEnforcedPolicy,
  buildNonceReportOnlyPolicy,
  nonceHostAllowed,
  nonceRouteAllowed,
  NONCE_SAME_ORIGIN_FRAME_ROUTES,
  sameOriginFramePolicy,
} from '@/tooling/content-security-policy.mjs';

// `_`-prefixed folders are private in the App Router, so no page can claim
// this path (tooling/verify-grammar-404-ssr-flow.mjs checks the served HTML).
// (A notFound() page inside the Grammar layout prerendered as a bare
// `__next_error__` shell: no CSS, no <title> until JS ran — PC-J230.)
const GRAMMAR_ARTICLE_NOT_FOUND_PATH = '/__aver-not-found';

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

async function grammarArticle(request: NextRequest) {
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

function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function nonceReportOnly(request: NextRequest) {
  // Inlined at build by next.config.ts `env`.
  if (process.env.AVER_CSP_NONCE_REPORT_ONLY !== '1') return NextResponse.next();
  const nonce = createNonce();
  const policy = buildNonceReportOnlyPolicy(nonce, process.env);
  const requestHeaders = new Headers(request.headers);
  // Next takes the nonce from `content-security-policy` before
  // `…-report-only`; a client-sent copy must not choose it.
  requestHeaders.delete('content-security-policy');
  requestHeaders.set('content-security-policy-report-only', policy);
  requestHeaders.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy-Report-Only', policy);
  return response;
}

function noncePolicy(request: NextRequest) {
  // Matcher exclusions are checked again here so direct calls and future
  // matcher edits cannot enable a blocking nonce policy on public/prod URLs.
  if (!nonceRouteAllowed(request.nextUrl.pathname)) return NextResponse.next();
  if (process.env.AVER_CSP_NONCE_ENFORCE !== '1') return nonceReportOnly(request);
  if (process.env.VERCEL_ENV === 'production' || !nonceHostAllowed(request.nextUrl.hostname)) {
    return NextResponse.next();
  }

  const nonce = createNonce();
  const baseline = buildNonceEnforcedPolicy(nonce, process.env);
  const policy = NONCE_SAME_ORIGIN_FRAME_ROUTES.includes(request.nextUrl.pathname)
    ? sameOriginFramePolicy(baseline) : baseline;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('content-security-policy', policy);
  requestHeaders.delete('content-security-policy-report-only');
  requestHeaders.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // `set` replaces next.config.ts's baseline header; never append a second
  // policy. The deployed checker rejects combined policies as well as gaps.
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export async function proxy(request: NextRequest) {
  return request.nextUrl.pathname.startsWith('/grammar/')
    ? grammarArticle(request)
    : noncePolicy(request);
}

// The production hosts never reach the nonce branch: its routes stay static
// there, and a proxy hop would only add latency. The section list is exactly
// the URL prefixes of the AuthedShell route groups
// (tests/csp-nonce-report-only.test.mjs walks app/ to keep it so). Public
// `/vocabulary` is not one of them; its signed-in subroutes are.
export const config = {
  matcher: [
    '/grammar/:category/:slug',
    {
      source: '/:section(admin|advanced-vocabulary|course-exercises|d1-exercise|exam|exercises|flashcard-study|flashcards|full-test|full-test-result|grammar-checkup|grammar-lessons|home|instructor|listening|mock|mock-exam|my-class|onboarding|practice|profile|quiz|reading|result|speaking|writing)/:path*',
      missing: [{ type: 'host', value: '(?:www\\.)?averlearning\\.com' }],
    },
    {
      source: '/vocabulary/:path+',
      missing: [{ type: 'host', value: '(?:www\\.)?averlearning\\.com' }],
    },
  ],
};
