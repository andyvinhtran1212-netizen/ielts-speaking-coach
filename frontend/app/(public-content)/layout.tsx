import { ReactNode } from 'react';
import Script from 'next/script';

import { BodyClassBridge } from '@/components/body-class-bridge';
import { NextPageViewBeacon } from '@/components/next-page-view-beacon';
import { SupabaseRuntimeBoundary } from '@/components/supabase-runtime-boundary';

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

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

export default function PublicContentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Canonical anti-flash theme bootstrap (DESIGN_SYSTEM § 13) */}
      <script
        dangerouslySetInnerHTML={{ __html: themeScript }}
        suppressHydrationWarning
      />

      {/* Stylesheets: tokens → components → ds → content CSS → tailwind (last for cascade) */}
      <link rel="stylesheet" href="/css/aver-design/tokens.css" />
      <link rel="stylesheet" href="/css/aver-design/components.css" />
      <link rel="stylesheet" href="/css/ds.css" />
      <link rel="stylesheet" href="/css/grammar-wiki.css" />
      <link rel="stylesheet" href="/css/vocab-wiki.css" />
      <link rel="stylesheet" href="/css/tailwind.build.css" />

      <SupabaseRuntimeBoundary
        supabaseUrl={SUPABASE_URL}
        supabaseAnonKey={SUPABASE_ANON}
      >
        <Script type="module" src="/js/components/aver-chrome.js" strategy="afterInteractive" />
        <NextPageViewBeacon />
      </SupabaseRuntimeBoundary>

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
      <BodyClassBridge className="av-page min-h-screen font-sans antialiased" />
      {children}
    </>
  );
}
