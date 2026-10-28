// SPIKE 1 — dark diagnostic route (plan Phase 2 critical-risk spike #1).
// NOT product code: no legacy chrome, no canonical URL, monospace diagnostics.
// The harness wrapper exists so tests can UNMOUNT the recorder component and
// assert the cleanup contract (mic released, no zombie recorder) — the exact
// React-lifecycle risk this spike measures.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { diagnosticRoutesEnabled } from '@/lib/diagnostic-routes.mjs';

import { SpikeHarness } from './spike-harness';

// BL-01: gate the metadata too. With a static `metadata` export the disabled
// route's 404 still carried this debug title (hoisted after hydration);
// failing here gives it the same head as any unknown URL ("Aver Learning").
export function generateMetadata(): Metadata {
  if (!diagnosticRoutesEnabled()) notFound();
  return {
    title: 'recorder-spike — MediaRecorder risk spike',
    robots: { index: false, follow: false },
  };
}

// Same static, real-404 gate as /next-probe (U-03): this page has no
// AuthProvider, so it must not render on staging/preview for signed-out visitors.
export default function RecorderSpikePage() {
  if (!diagnosticRoutesEnabled()) notFound();
  return <SpikeHarness />;
}
