import type { ReactNode } from 'react';

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

const INIT_SUPABASE = `
document.addEventListener('DOMContentLoaded', function () {
  if (typeof initSupabase === 'function') {
    initSupabase(
      'https://huwsmtubwulikhlmcirx.supabase.co',
      'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao'
    );
  }
});
`.trim();

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

      <script
        src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.107.0/dist/umd/supabase.min.js"
        defer
      />
      <script src="/js/runtime-config.js" defer />
      <script src="/js/error-reporter.js" defer />
      <script src="/js/api.js" defer />
      <script src="/js/analytics-beacon.js" defer />
      <script src="/js/rum-vitals.js" defer />
      <script dangerouslySetInnerHTML={{ __html: INIT_SUPABASE }} />
      {children}
    </>
  );
}
