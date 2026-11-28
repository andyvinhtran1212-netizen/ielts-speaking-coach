// Route group of /enroll/[orderCode] (ENROLL-0060 FR-037…FR-040, G05-T12): a v2 learner
// page on the "Bản in" tree. Outside the activation gate (`authGated={false}`):
// the learner stays inactive until the order is confirmed (GOI-05 5.1), and
// G04's order routes are activation-exempt. The page asks for a session.
import type { Viewport } from 'next';
import type { ReactNode } from 'react';

import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { AuthedShell } from '@/components/authed-shell';
import { LearnerFrame } from '@/components/learner/learner-frame';
import { AV2_VIEWPORT } from '@/components/ui/theme-color';
import { av2FontClass } from '@/styles/av2/fonts';

export const viewport: Viewport = AV2_VIEWPORT;

export default function AuthedEnrollLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell design="v2" chrome="none" authGated={false} bodyClass={`av2-root av2-body ${av2FontClass}`}>
      <div className={`av2-root ${av2FontClass}`}>
        <LearnerFrame>{children}</LearnerFrame>
      </div>
    </AuthedShell>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
