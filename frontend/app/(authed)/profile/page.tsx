// Pilots 3 (authenticated READ) + 4 (reversible MUTATION) — SAME page.
// CUTOVER (prep): canonical route is now `/profile` (a new clean URL);
// legacy /pages/profile.html consolidates via a redirect (next.config.ts).
//
// The page itself is a fully static shell: NO server-side data fetch — the
// bearer token never crosses an RSC boundary (ADR-003 §3), so all private
// data arrives client-side through window.api against FastAPI, exactly like
// the legacy page. The prerendered HTML contains only placeholders ("—").
import type { Metadata } from 'next';

import { ProfileShell } from './page-shell';
import { ProfileBehavior } from './profile-behavior';

export const metadata: Metadata = {
  // Byte-faithful to the legacy <title>
  title: 'Hồ sơ — AverLearning',
  // Private authed route (unauthenticated visitors are bounced to /login) —
  // must not be indexed.
  robots: { index: false, follow: false },
};

export default function ProfilePreviewPage() {
  return (
    <>
      <ProfileShell />
      <ProfileBehavior />
    </>
  );
}
