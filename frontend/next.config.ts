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

import {
  buildLegacyRetirementRedirects,
  discoverLegacyHtmlPaths,
} from './tooling/gate-f-retirement-redirects.mjs';

// Gate F redirect-soak candidate. The helper hash-pins the exact Legacy
// artifact set and fails config evaluation if a page changes without review.
// Soak uses temporary 307 redirects: a cached 308 could strand clients on a
// missing Next route after rollback. The final reviewed retirement release
// flips this to true only after Gate E and redirect-soak evidence close.
const LEGACY_RETIREMENT_REDIRECTS_PERMANENT = false;
const LEGACY_RETIREMENT_REDIRECTS = buildLegacyRetirementRedirects(
  discoverLegacyHtmlPaths(path.join(__dirname, 'public')),
  { permanent: LEGACY_RETIREMENT_REDIRECTS_PERMANENT },
);

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
        // /index.html stays on disk as a rollback artifact and is intercepted
        // by the generated Gate F manifest while redirect soak is active.
        // Legacy-owned clean URLs (from vercel.json, unchanged shapes).
        // PILOT 2 CUTOVER (prep): `/grammar/:category/:slug` is now the Next
        // app route app/(public-content)/grammar/[category]/[slug]. The legacy
        // rewrite is REMOVED atomically (route-ownership check enforces it).
        // Legacy /pages/grammar-article.html stays on disk as a rollback
        // artifact. The Gate F manifest translates its category/slug query
        // identity into the canonical dynamic App Router path.
        // `/writing/dashboard` KHÔNG còn ở đây: nay là route Next
        // (`app/(authed-writing)/writing/dashboard/`). Gỡ dòng rewrite và thêm
        // route PHẢI cùng một commit — cổng route-ownership chặn trạng thái nửa
        // vời, vì một URL không thể vừa là route vừa là rewrite sang legacy.
        // `/pages/writing-dashboard.html` remains on disk for rollback; the
        // Gate F manifest intercepts its public URL during redirect soak.
        // `/admin/writing/prompts` is now owned by the native Next route;
        // direct `/pages/admin/writing/prompts.html` remains the rollback page.
        // `/admin/writing/tips` is native; direct legacy HTML stays available
        // at `/pages/admin/writing/tips.html` for rollback.
        // `/admin/writing/cohorts` is native; direct legacy HTML stays
        // available at `/pages/admin/writing/cohorts.html` for rollback.
        // `/admin/writing/regrade-requests` is native; direct legacy HTML stays
        // available at `/pages/admin/writing/regrade-requests.html` for rollback.
        // `/admin/writing/assignments` is native; direct legacy HTML stays
        // available at `/pages/admin/writing/assignments.html` for rollback.
        // `/admin/writing/instructor-queue` is native; direct legacy HTML stays
        // available at `/pages/admin/writing/instructor-queue.html` for rollback.
        // CUTOVER 2026-08-05 — `/home` nay là ROUTE NEXT
        // (`app/(authed-home)/home/`), không còn rewrite sang bản legacy.
        // Gỡ dòng này PHẢI đi cùng commit đổi route: cổng route-ownership chặn
        // trạng thái nửa vời ("app route /home is SHADOWED by config source
        // /home") — đã thấy nó báo đúng khi tôi đổi route trước, gỡ rewrite sau.
        // `/pages/home.html` remains on disk for rollback but is intercepted
        // before public-file serving during Gate F redirect soak.
        // CUTOVER 2026-08-05 — `/speaking` nay là ROUTE NEXT
        // (`app/(authed-speaking)/speaking/`), không còn rewrite sang legacy.
        // Gỡ dòng này PHẢI đi cùng commit đổi route: cổng route-ownership chặn
        // trạng thái nửa vời. `/pages/speaking.html` remains a rollback file
        // but its public URL is intercepted throughout redirect soak.
      ],
      afterFiles: [],
      fallback: [],
    };
  },

  async redirects() {
    // Permanent legacy-path consolidation — ported 1:1 from vercel.json.
    return [
      // GATE F REDIRECT SOAK: temporary redirects run before public-file serving, so no
      // frozen HTML artifact can render while this release is active. Keep the
      // generated manifest as the single owner of those sources; duplicate
      // literal rules could compile into contradictory route behavior.
      ...LEGACY_RETIREMENT_REDIRECTS,
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
      // Native Users pilot owns the clean access-code alias. Temporary on
      // purpose: reverting the pilot must make this alias safe to repoint to
      // the public rollback artifact without a browser-cached 308 stranding it.
      { source: '/admin/access-codes', destination: '/admin/users?tab=codes', permanent: false },
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
        // AUDIT F5 (2026-07-14): runtime-config.js is the release/environment
        // PROVENANCE MARKER — telemetry release tags, post-cutover and
        // rollback verification, and the nightly drift monitor all read it.
        // Under the generic /js/* 300s rule a browser/CDN could serve a
        // 5-minute-stale marker, silently mis-tagging telemetry and lying to
        // rollback verification. It must always be revalidated. Placed AFTER
        // /js/:path* — for the same header key, the LAST matching rule wins.
        source: '/js/runtime-config.js',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
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
