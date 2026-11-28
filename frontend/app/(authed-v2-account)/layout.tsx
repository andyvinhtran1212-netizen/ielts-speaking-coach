// Route group of /account (LEARNERCORE-0063 FR-060, FR-087, FR-090): a v2 learner page on
// the "Bản in" tree. AuthedShell keeps the session gate and the runtime
// boundary; LearnerFrame puts the page in LearnerShell with the real profile.
// Own group, so no legacy stylesheet of another learner page reaches it.
import type { Viewport } from 'next';
import type { ReactNode } from 'react';

import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { AuthedShell } from '@/components/authed-shell';
import { LearnerFrame } from '@/components/learner/learner-frame';
import { AV2_VIEWPORT } from '@/components/ui/theme-color';
import { av2FontClass } from '@/styles/av2/fonts';

export const viewport: Viewport = AV2_VIEWPORT;

export default function AuthedAccountLayout({ children }: { children: ReactNode }) {
  return (
    // `av2-root` on <body> too, so the paper reaches the window edges (base.css
    // drops the UA body margin there), same as the (public-v2) layout.
    <AuthedShell design="v2" chrome="none" bodyClass={`av2-root av2-body ${av2FontClass}`}>
      <div className={`av2-root ${av2FontClass}`}>
        <LearnerFrame>{children}</LearnerFrame>
      </div>
    </AuthedShell>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
