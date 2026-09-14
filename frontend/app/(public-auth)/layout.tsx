import type { ReactNode } from 'react';

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

export default function PublicAuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH }} />
      <link rel="stylesheet" href="/css/aver-design/tokens.css" />
      <link rel="stylesheet" href="/css/aver-design/components.css" />
      <link rel="stylesheet" href="/css/login-next.css" />
      <link rel="stylesheet" href="/css/tailwind.build.css" />

      <SupabaseRuntimeBoundary
        supabaseUrl={SUPABASE_URL}
        supabaseAnonKey={SUPABASE_ANON}
      >
        <NextPageViewBeacon />
      </SupabaseRuntimeBoundary>
      {children}
    </>
  );
}
