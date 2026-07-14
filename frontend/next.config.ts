// Source of truth for same-application routing during coexistence (ADR-002).
// Ported 1:1 from the old frontend/vercel.json on 2026-07-13 (Phase 1 —
// mechanical move); vercel.json now only pins the framework preset.
//
// PHASES (ADR-002 requires each rule to name its phase):
//   * legacy clean-URL rewrites live in `beforeFiles` ON PURPOSE: they win
//     over any future app route, so cutting a route over to Next REQUIRES
//     removing its rewrite in the same change (atomic ownership transfer —
//     plan §8.2); the route-ownership check turns a forgotten removal into
//     a build failure instead of a silent shadow.
//   * `/` → /index.html is beforeFiles: the app directory must never own
//     the root until the root migrates (plan §8.1).
import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A stray lockfile in the developer HOME makes Next infer the wrong
  // workspace root (breaks the TypeScript step with "id must be a string").
  turbopack: { root: path.join(__dirname) },

  // ADR-008: public-content SSR caches via Cache Components
  // ('use cache' + cacheLife in lib/grammar-api.ts).
  cacheComponents: true,

  // The legacy compat symlink `pages -> public/pages` collides with Next's
  // Pages Router directory name. Restricting page extensions to TS keeps that
  // symlinked HTML tree permanently inert as a router source (the App Router
  // in app/ is the only real router).
  pageExtensions: ['tsx', 'ts'],

  async rewrites() {
    return {
      beforeFiles: [
        // PILOT 1 CUTOVER (2026-07-14): `/` is now the Next app route
        // app/(marketing)/page.tsx. The old `/` → /index.html rewrite is
        // REMOVED in the same change (route-ownership check enforces this
        // atomicity — leaving it here would shadow the app route). Legacy
        // /index.html stays on disk for instant rollback and is consolidated
        // to `/` via the redirect below.
        // Legacy-owned clean URLs (from vercel.json, unchanged shapes).
        { source: '/grammar/:category/:slug', destination: '/pages/grammar-article.html' },
        { source: '/writing/dashboard', destination: '/pages/writing-dashboard.html' },
        { source: '/writing/result', destination: '/pages/writing-result.html' },
        { source: '/admin/writing/prompts', destination: '/pages/admin/writing/prompts.html' },
        { source: '/admin/writing/tips', destination: '/pages/admin/writing/tips.html' },
        { source: '/admin/writing/cohorts', destination: '/pages/admin/writing/cohorts.html' },
        { source: '/admin/writing/regrade-requests', destination: '/pages/admin/writing/regrade-requests.html' },
        { source: '/admin/writing/assignments', destination: '/pages/admin/writing/assignments.html' },
        { source: '/home', destination: '/pages/home.html' },
        { source: '/speaking', destination: '/pages/speaking.html' },
      ],
      afterFiles: [],
      fallback: [],
    };
  },

  async redirects() {
    // Permanent legacy-path consolidation — ported 1:1 from vercel.json.
    return [
      // PILOT 1 CUTOVER: one canonical landing. Direct hits to the legacy
      // file (bookmarks, aver-chrome logout → '/index.html') consolidate to
      // the Next landing at `/`. Redirects run before the filesystem, so the
      // on-disk public/index.html is never served while this is active — but
      // it stays on disk so reverting this commit restores the old behavior.
      { source: '/index.html', destination: '/', permanent: true },
      // PILOTS 3+4 CUTOVER: profile page → canonical `/profile` (Next app
      // route app/(authed)/profile). No legacy rewrite to remove (the legacy
      // page was a direct public file), so the atomicity here is: the app
      // route + this redirect land together. TEMPORARY (307) on purpose —
      // unlike `/` (which always serves something), `/profile` 404s if this
      // pilot is rolled back, so a browser-cached PERMANENT redirect would
      // strand users on a 404; a temporary redirect isn't cached long-term.
      // No SEO cost (authed route is noindex). aver-chrome/user-pill keep
      // linking to /pages/profile.html (stable file path) — it redirects
      // when the pilot is live and serves legacy directly on rollback.
      { source: '/pages/profile.html', destination: '/profile', permanent: false },
      { source: '/pages/dashboard.html', destination: '/pages/speaking.html', permanent: true },
      { source: '/pages/my-vocabulary.html', destination: '/pages/vocabulary.html', permanent: true },
      { source: '/pages/admin-writing.html', destination: '/pages/admin/writing/index.html', permanent: true },
      { source: '/pages/admin-writing-new.html', destination: '/pages/admin/writing/new.html', permanent: true },
      { source: '/pages/admin-writing-grade.html', destination: '/pages/admin/writing/grade.html', permanent: true },
      { source: '/pages/admin-writing-status.html', destination: '/pages/admin/writing/status.html', permanent: true },
      { source: '/pages/admin-writing-assignments.html', destination: '/pages/admin/writing/assignments.html', permanent: true },
      { source: '/pages/admin-writing-prompts.html', destination: '/pages/admin/writing/prompts.html', permanent: true },
      { source: '/pages/admin-instructor-queue.html', destination: '/pages/admin/writing/instructor-queue.html', permanent: true },
      { source: '/pages/admin-students.html', destination: '/pages/admin/students/index.html', permanent: true },
      { source: '/pages/admin-listening-segments.html', destination: '/pages/admin/listening/segments.html', permanent: true },
      { source: '/pages/admin-listening-gist.html', destination: '/pages/admin/listening/gist.html', permanent: true },
      { source: '/pages/admin-listening-tf.html', destination: '/pages/admin/listening/tf.html', permanent: true },
      { source: '/pages/admin-listening-mcq.html', destination: '/pages/admin/listening/mcq.html', permanent: true },
      { source: '/admin/access-codes', destination: '/pages/admin/users/index.html?tab=codes', permanent: true },
      { source: '/pages/admin/access-codes/index.html', destination: '/pages/admin/users/index.html?tab=codes', permanent: true },
      { source: '/pages/admin/dashboard/index.html', destination: '/pages/admin/index.html', permanent: true },
    ];
  },

  async headers() {
    // Ported from vercel.json with two documented deltas (effective headers
    // are re-verified on Preview per plan §8.5):
    //   * the old `*.html → max-age=0` rule is dropped — Next's default for
    //     public/ assets is already `public, max-age=0, must-revalidate`.
    //   * the old any-extension image/font rule (86400) narrows to /assets/*
    //     and /favicon.svg — the only local asset locations.
    return [
      {
        source: '/js/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=300, must-revalidate' }],
      },
      {
        source: '/css/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=300, must-revalidate' }],
      },
      {
        source: '/assets/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
      {
        source: '/favicon.svg',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
    ];
  },
};

export default nextConfig;
