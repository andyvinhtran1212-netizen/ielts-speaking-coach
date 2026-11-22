// Layout of the public Library (LIBRARY-0061 T008; GOI-06 §5.1).
//
// Public: no login wall and no activation gate (FR-001), so it is not an
// AuthedShell layout and is not in the `proxy.ts` matcher.
//
// Page frame (FR-002), temporary: until the "Bản in" PublicShell/LearnerShell
// land (UIBASE-0056 G03-T13/T14), the Library uses the existing session-aware
// <aver-chrome> header, the same one the Grammar Wiki uses today: a guest sees
// the public bar and a signed-in learner sees their own. It renders in Shadow
// DOM, so it only needs the legacy --av-* custom properties (aver-design
// tokens.css); the legacy content stylesheets (ds.css, grammar-wiki.css,
// vocab-wiki.css, tailwind) are NOT loaded here. Swapping to the G03 shell
// later only touches this file. Coordinator decision 22/11, open to
// anh Andy's override at review.
import type { Viewport } from 'next';
import Script from 'next/script';
import type { ReactNode } from 'react';

import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { av2FontClass } from '@/styles/av2/fonts';
import { AV2_VIEWPORT } from '@/components/ui/theme-color';
import { ThemeScript } from '@/components/ui/theme-script';
import { NextPageViewBeacon } from '@/components/next-page-view-beacon';
import { RedirectNotice } from '@/components/redirect-notice';
import { SupabaseRuntimeBoundary } from '@/components/supabase-runtime-boundary';

import styles from './library-layout.module.css';

export const viewport: Viewport = AV2_VIEWPORT;

const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

export default function PublicLibraryLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ThemeScript />
      {/* --av-* custom properties for the Shadow DOM header only (see above). */}
      <link rel="stylesheet" href="/css/aver-design/tokens.css" />
      <Script type="module" src="/js/components/aver-chrome.js" strategy="afterInteractive" crossOrigin="anonymous" />
      <SupabaseRuntimeBoundary supabaseUrl={SUPABASE_URL} supabaseAnonKey={SUPABASE_ANON}>
        <NextPageViewBeacon />
      </SupabaseRuntimeBoundary>
      <div className={`av2-root ${av2FontClass} ${styles.root}`}>
        <aver-chrome />
        {children}
      </div>
      <RedirectNotice />
    </>
  );
}
