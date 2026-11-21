import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';

import { AV2_VIEWPORT, ThemeMenu } from '@/components/ui';
import { uiLibraryEnabled } from '@/lib/diagnostic-routes.mjs';

// UIBASE-0056 G03-T12 — diagnostic page for the hard v1 / v2 boundary
// (FR-015, acceptance scenarios 1–2). Same gate as /ui-library, so the CI
// visual job can drive it without opening /next-probe or /recorder-spike.
// Removed in G03-T14 together with its layout and its four list entries.
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
    <main data-testid="v2-pilot">
      <h1>Thử khung v2</h1>
      <p>Trang chẩn đoán: chuyển giữa cây giao diện cũ và cây &ldquo;Bản in&rdquo; luôn tải lại cả trang.</p>
      <ThemeMenu />
      {/* A v1 destination: a plain <a>, never next/link (plan 5.7.3). */}
      <p><a href="/flashcard-study" data-testid="to-v1">Về trang ôn thẻ (giao diện cũ)</a></p>
    </main>
  );
}
