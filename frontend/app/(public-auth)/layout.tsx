import type { ReactNode } from 'react';
import Script from 'next/script';

import { NextPageViewBeacon } from '@/components/next-page-view-beacon';
import { SupabaseRuntimeBoundary } from '@/components/supabase-runtime-boundary';

const ANTI_FLASH = `
(function () {
  try {
    var theme = localStorage.getItem('av-theme');
    if (theme !== 'light' && theme !== 'dark') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';
const SUPABASE_RUNTIME_SCRIPTS = [
  {
    src: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js',
    continueOnError: true,
  },
  { src: '/js/supabase-sdk-fallback.js' },
  { src: '/js/runtime-config.js' },
  { src: '/js/error-reporter.js', continueOnError: true },
  { src: '/js/api.js' },
] as const;

export default function PublicAuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="/css/aver-design/tokens.css" />
      <link rel="stylesheet" href="/css/aver-design/components.css" />
      <link rel="stylesheet" href="/css/login-next.css" />
      <link rel="stylesheet" href="/css/tailwind.build.css" />

      <SupabaseRuntimeBoundary
        scripts={SUPABASE_RUNTIME_SCRIPTS}
        supabaseUrl={SUPABASE_URL}
        supabaseAnonKey={SUPABASE_ANON}
      >
        <NextPageViewBeacon />
        <Script src="/js/rum-vitals.js" strategy="afterInteractive" />
      </SupabaseRuntimeBoundary>
      {children}
    </>
  );
}
