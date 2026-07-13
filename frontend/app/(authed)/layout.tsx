// Authed route-group layout — legacy chrome context for authenticated
// parity-ported pages (pilot 3: profile). Head assets are byte-faithful to
// pages/profile.html: same fonts (Plus Jakarta Sans + JetBrains Mono), same
// stylesheet cascade (tokens → components → ds → profile.css → tailwind LAST,
// P0-3 C-3.4), same deferred script order (supabase CDN → runtime-config →
// api.js → initSupabase on DOMContentLoaded).
//
// Auth is CLIENT-ONLY (ADR-003 §3): this layout is a Server Component but
// reads no cookies/headers — it renders the static shell and mounts
// AuthProvider, which consumes the window Supabase client that api.js creates.
import { ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth/auth-provider';

// Canonical anti-flash theme bootstrap (DESIGN_SYSTEM § 13) — must run before
// any stylesheet so [data-theme] is set on <html> before paint.
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

// Byte-faithful to profile.html: prod credentials are the FALLBACK — the
// generated runtime-config (loaded before api.js) wins on Vercel, which is
// what keeps Preview/staging off the production Supabase (ADR-006).
const SUPABASE_INIT = `
var SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
var SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
document.addEventListener('DOMContentLoaded', function () {
  if (typeof initSupabase === 'function') {
    initSupabase(SUPABASE_URL, SUPABASE_ANON);
  }
});
`.trim();

// Lucide hydration (chrome glyphs) — verbatim from profile.html.
const LUCIDE_HYDRATE = `
(function () {
  function hydrateIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateIcons);
  } else {
    hydrateIcons();
  }
  window.addEventListener('load', hydrateIcons);
})();
`.trim();

export default function AuthedLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH }} suppressHydrationWarning />

      {/* Font preconnects + faces — profile.html set, NOT the public-content set */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />

      {/* Aver Design System cascade (tokens before components before page CSS;
          static Tailwind LAST so utilities/.hidden win — P0-3 C-3.4) */}
      <link rel="stylesheet" href="/css/aver-design/tokens.css" />
      <link rel="stylesheet" href="/css/aver-design/components.css" />
      <link rel="stylesheet" href="/css/ds.css" />
      <link rel="stylesheet" href="/css/profile.css" />
      <link rel="stylesheet" href="/css/tailwind.build.css" />

      {/* Same CDN pins as legacy (lucide@1.17.0, supabase-js@2.107.0) */}
      <script src="https://unpkg.com/lucide@1.17.0" defer />
      <script
        src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js"
        defer
      />
      <script src="/js/runtime-config.js" defer />
      <script src="/js/api.js" defer />
      <script dangerouslySetInnerHTML={{ __html: SUPABASE_INIT }} />
      <script dangerouslySetInnerHTML={{ __html: LUCIDE_HYDRATE }} />

      {/* Canonical chrome Web Component (Sprint 7.13) */}
      <script type="module" src="/js/components/aver-chrome.js" />

      {/* profile.css / ds.css scope page rules under body classes — React must
          not own <body> attributes (root layout does), so classes are applied
          pre-paint with the same inline-script technique as the anti-flash
          IIFE (established in pilot 2, review #741). Exact legacy class list:
          profile.html <body class="av-page font-sans min-h-screen">. */}
      <script
        dangerouslySetInnerHTML={{
          __html: "document.body.className += ' av-page font-sans min-h-screen';",
        }}
      />
      <AuthProvider>{children}</AuthProvider>
    </>
  );
}
