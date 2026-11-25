// "Bản in" public route group (UIBASE-0056 G03-T13, FR-002, FR-011): the four
// legal pages, and later G05's public pages. A layout of its own, not
// AuthedShell: no session, no legacy cascade. Nothing here loads tokens.css,
// components.css, ds.css, tailwind.build.css, Lucide, aver-chrome.js or
// aver-admin-chrome.js. A nested layout must not render <html>/<body>; the
// root layout owns them.
import type { Viewport } from 'next';
import type { ReactNode } from 'react';

import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { av2FontClass } from '@/styles/av2/fonts';
import { BodyClassBridge } from '@/components/body-class-bridge';
import { NextPageViewBeacon } from '@/components/next-page-view-beacon';
import { SupabaseRuntimeBoundary } from '@/components/supabase-runtime-boundary';
import { AV2_VIEWPORT } from '@/components/ui/theme-color';
import { ThemeScript } from '@/components/ui/theme-script';

// Same public project values as the (public-content) and (public-auth) layouts.
const SUPABASE_URL = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

// `av2-root` and the font variables go on <body> too, so the page background
// reaches the window edges and <body> itself computes to Source Sans 3
// (acceptance scenario 1). Added before paint, like the legacy layouts'
// body-class script; BodyClassBridge keeps it right after hydration.
const BODY_CLASS = `av2-root av2-body ${av2FontClass}`;
const BODY_CLASS_SCRIPT = `document.body.className += ${JSON.stringify(` ${BODY_CLASS}`)};`;

// Two theme-color metas, one per OS mode (FR-026); ThemeMenu re-points them.
export const viewport: Viewport = AV2_VIEWPORT;

export default function PublicV2Layout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* First, so a stored or device dark never paints light (FR-020). */}
      <ThemeScript />
      <script dangerouslySetInnerHTML={{ __html: BODY_CLASS_SCRIPT }} />
      <BodyClassBridge className={BODY_CLASS} />

      {/* Telemetry (telemetry-coverage.test.mjs, which follows only file
          imports, so the ui imports above name their files): the boundary loads
          runtime-config.js and error-reporter.js; the beacon sends page_view. */}
      <SupabaseRuntimeBoundary supabaseUrl={SUPABASE_URL} supabaseAnonKey={SUPABASE_ANON}>
        <NextPageViewBeacon />
      </SupabaseRuntimeBoundary>

      <div className={`av2-root ${av2FontClass}`}>{children}</div>
    </>
  );
}
