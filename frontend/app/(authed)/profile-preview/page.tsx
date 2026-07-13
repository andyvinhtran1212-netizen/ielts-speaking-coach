// Pilot 3 — authenticated READ (plan Phase 2 pilot #3), dark-launched at
// /profile-preview. The canonical /pages/profile.html stays legacy-owned
// until its atomic cutover.
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
};

export default function ProfilePreviewPage() {
  return (
    <>
      <ProfileShell />
      <ProfileBehavior />
    </>
  );
}
