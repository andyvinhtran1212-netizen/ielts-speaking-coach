import { ReactNode } from 'react';

export const metadata = {
  title: 'Grammar Wiki — IELTS Grammar | Aver Learning',
  description: 'Học ngữ pháp tiếng Anh để cải thiện IELTS Speaking và Writing. Ví dụ thực tế, bài tập, và lời giải thích dễ hiểu.',
};

const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('av-theme');
    var theme;
    if (stored === 'light' || stored === 'dark') {
      theme = stored;
    } else {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function PublicContentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Canonical anti-flash theme bootstrap (DESIGN_SYSTEM § 13) */}
      <script
        dangerouslySetInnerHTML={{ __html: themeScript }}
        suppressHydrationWarning
      />

      {/* Font preconnects */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* Stylesheets: tokens → components → ds → grammar-wiki.css → tailwind (last for cascade) */}
      <link rel="stylesheet" href="/css/aver-design/tokens.css" />
      <link rel="stylesheet" href="/css/aver-design/components.css" />
      <link rel="stylesheet" href="/css/ds.css" />
      <link rel="stylesheet" href="/css/grammar-wiki.css" />
      <link rel="stylesheet" href="/css/tailwind.build.css" />

      {/* Canonical chrome Web Component (Sprint 7.13) */}
      <script type="module" src="/js/components/aver-chrome.js" defer />

      {/* Grammar API + auth client scripts (C-3.2: deferred off parse path) */}
      <script
        src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js"
        defer
      />
      <script src="/js/runtime-config.js" defer />
      <script src="/js/api.js" defer />
      <script src="/js/analytics-beacon.js" defer />
      {/* AUDIT F2: field Web Vitals per implementation tag (rollback-metrics
          reads them for the frozen LCP trigger). */}
      <script src="/js/rum-vitals.js" defer />

      {/* Supabase init + child initialization */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
var SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
var SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
document.addEventListener('DOMContentLoaded', function () {
  if (typeof initSupabase === 'function') {
    initSupabase(SUPABASE_URL, SUPABASE_ANON);
  }
});
          `,
        }}
      />

      {/* grammar-wiki.css scopes overrides under body.av-page (e.g.
          `body.av-page .text-white` recolors to readable) — a div wrapper
          cannot satisfy those selectors, and React must not own <body>
          attributes here. Same pre-paint technique as the anti-flash IIFE. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.body.className += ' av-page min-h-screen font-sans antialiased';",
        }}
      />
      {children}
    </>
  );
}
