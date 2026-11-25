import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';

import { AV2_VIEWPORT } from '@/components/ui/theme-color';
import { uiLibraryEnabled } from '@/lib/diagnostic-routes.mjs';

import { PilotLearnerShell } from './pilot-shell';

// UIBASE-0056 G03-T12/T14 — diagnostic page for the hard v1 / v2 boundary
// (FR-015, acceptance scenarios 1–2) and, from T14, the LearnerShell on a
// real per-request AuthedShell page with sample data (no session, no API).
// Same gate as /ui-library, so the CI visual job can drive it without opening
// /next-probe or /recorder-spike. It renders per request (AuthedShell), so the
// gate reads the server's env when served (CI sets the flag on `next start`
// too), and a disabled deployment gets Next's not-found UI as a soft 404
// (HTTP 200 + noindex), like every notFound() under AuthedShell.
// Removed when G07 puts the first real learner page on LearnerShell, together
// with its layout, its registry and V2_ROUTES entries and its three list
// entries (EXEMPT, DEBUG_GATED, NON_PRODUCT_APP_PAGE_ROUTES).
export function generateMetadata(): Metadata {
  if (!uiLibraryEnabled()) notFound();
  return {
    title: 'Thử khung v2',
    robots: { index: false, follow: false },
  };
}

export function generateViewport(): Viewport {
  return AV2_VIEWPORT;
}

export default function V2PilotPage() {
  if (!uiLibraryEnabled()) notFound();
  return (
    <PilotLearnerShell>
      <div data-testid="v2-pilot">
        <h1>Thử khung v2</h1>
        <p>Trang chẩn đoán: chuyển giữa cây giao diện cũ và cây &ldquo;Bản in&rdquo; luôn tải lại cả trang.</p>
        {/* A v1 destination: a plain <a>, never next/link (plan 5.7.3). */}
        <p><a href="/flashcard-study" data-testid="to-v1">Về trang ôn thẻ (giao diện cũ)</a></p>
      </div>
    </PilotLearnerShell>
  );
}
