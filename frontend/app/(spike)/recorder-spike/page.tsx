// SPIKE 1 — dark diagnostic route (plan Phase 2 critical-risk spike #1).
// NOT product code: no legacy chrome, no canonical URL, monospace diagnostics.
// The harness wrapper exists so tests can UNMOUNT the recorder component and
// assert the cleanup contract (mic released, no zombie recorder) — the exact
// React-lifecycle risk this spike measures.
import type { Metadata } from 'next';

import { SpikeHarness } from './spike-harness';

export const metadata: Metadata = {
  title: 'recorder-spike — MediaRecorder risk spike',
  robots: { index: false, follow: false },
};

export default function RecorderSpikePage() {
  return <SpikeHarness />;
}
