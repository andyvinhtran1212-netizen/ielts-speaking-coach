// Marketing route-group layout — legacy chrome context for parity-ported
// pages (pilot 1: landing). A nested layout must NOT render <html>/<body>
// (the root layout owns them); stylesheet <link> tags render here and React
// hoists them into <head>.
import type { ReactNode } from 'react';

// Legacy head scripts, kept byte-faithful (index.html):
//  1. OAuth-redirect recovery — Supabase OAuth lands users on the SITE ROOT
//     with #access_token / ?code=; legacy forwards them to /login.html to
//     finish sign-in. Harmless on the dark preview URL, REQUIRED the moment
//     this layout serves `/` (root cutover parity item).
//  2. Anti-flash theme IIFE — sets [data-theme] before first paint. Rendered
//     as the first element so it executes before the page paints (same
//     pattern next-themes uses).
const OAUTH_RECOVERY = `
(function () {
  var h = window.location.hash, s = window.location.search;
  if (h.indexOf('access_token=') !== -1 || s.indexOf('code=') !== -1) {
    window.location.replace('/login.html' + s + h);
  }
})();
`.trim();

const ANTI_FLASH = `
(function () {
  try {
    var stored = localStorage.getItem('av-theme');
    var prefersDark = window.matchMedia &&
                      window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = (stored === 'light' || stored === 'dark')
                ? stored
                : (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: OAUTH_RECOVERY }} />
      <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH }} />

      {/* Legacy stylesheets — SAME deployed URLs as every legacy page (byte
          reuse + shared HTTP cache); React hoists these links into <head>. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="/css/aver-design/tokens.css" />
      <link rel="stylesheet" href="/css/aver-design/components.css" />
      <link rel="stylesheet" href="/css/index.css" />
      <link rel="stylesheet" href="/css/tailwind.build.css" />

      {/* Same CDN pin as legacy (Phase 1 CDN inventory: lucide@1.17.0). */}
      <script src="https://unpkg.com/lucide@1.17.0" defer />
      {/* Generated runtime config — before any consumer (plan §7.1). */}
      <script src="/js/runtime-config.js" />
      {/* ADR-012 observability: this migrated (pilot-1) landing must emit
          error telemetry tagged `implementation=next` so the cutover
          dashboard has an error signal for the soak (the rollback trigger
          reads it). error-reporter is self-contained — it resolves its own
          API base and reads __next_f + runtime-config for the tag, so it
          works without api.js (which the lean marketing page doesn't load).
          Loaded AFTER runtime-config so the release tag is available. */}
      <script src="/js/error-reporter.js" defer />
      {/* AUDIT F2: field Web Vitals (LCP/CLS/INP) per implementation tag —
          the frozen LCP rollback trigger reads these via rollback-metrics.
          Self-contained like error-reporter; after runtime-config. */}
      <script src="/js/rum-vitals.js" defer />

      {children}
    </>
  );
}
