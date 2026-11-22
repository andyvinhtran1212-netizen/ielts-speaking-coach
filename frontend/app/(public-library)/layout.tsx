// Layout of the public Library (LIBRARY-0061 T008; GOI-06 §5.1).
//
// Public: no login wall and no activation gate (FR-001), so it is not an
// AuthedShell layout and is not in the `proxy.ts` matcher.
//
// Page frame (FR-002): the "Bản in" PublicShell (UIBASE-0056 G03-T13), built
// like the `(public-v2)` layout. No legacy cascade: nothing here loads
// tokens.css, components.css, ds.css, tailwind.build.css, Lucide,
// aver-chrome.js or aver-admin-chrome.js. Signed-in learners see the guest bar
// too until LearnerShell (G03-T14) lands; that change only touches this file.
// No <RedirectNotice>: it is styled with the legacy --av-* tokens only; the
// v2 notice is G07's (same as the (public-v2) layout).
// A nested layout must not render <html>/<body>; the root layout owns them.
import type { Viewport } from 'next';
import type { ReactNode } from 'react';

import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { av2FontClass } from '@/styles/av2/fonts';
import { BodyClassBridge } from '@/components/body-class-bridge';
import { NextPageViewBeacon } from '@/components/next-page-view-beacon';
import { SupabaseRuntimeBoundary } from '@/components/supabase-runtime-boundary';
import { PublicShell } from '@/components/ui/shell/public-shell';
import { AV2_VIEWPORT } from '@/components/ui/theme-color';
import { ThemeScript } from '@/components/ui/theme-script';

// Same public project values as the (public-content) and (public-v2) layouts.
const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

// `av2-root` and the font variables go on <body> too, so the page background
// reaches the window edges (same as the (public-v2) layout).
const BODY_CLASS = `av2-root av2-body ${av2FontClass}`;
const BODY_CLASS_SCRIPT = `document.body.className += ${JSON.stringify(` ${BODY_CLASS}`)};`;

export const viewport: Viewport = AV2_VIEWPORT;

export default function PublicLibraryLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* First, so a stored or device dark never paints light (FR-020). */}
      <ThemeScript />
      <script dangerouslySetInnerHTML={{ __html: BODY_CLASS_SCRIPT }} />
      <BodyClassBridge className={BODY_CLASS} />
      <SupabaseRuntimeBoundary supabaseUrl={SUPABASE_URL} supabaseAnonKey={SUPABASE_ANON}>
        <NextPageViewBeacon />
      </SupabaseRuntimeBoundary>
      <div className={`av2-root ${av2FontClass}`}>
        <PublicShell active="library">{children}</PublicShell>
      </div>
    </>
  );
}
