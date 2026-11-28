// Lộ trình route group (LEARNERCORE-0063 T15, amendment 1). A v2 tree on the
// "Bản in" design (UIBASE-0056 plan 5.7.2: v2 groups are `(authed-v2-<khu>)`):
// no legacy cascade, no aver-chrome; LearnerShell comes from LearnerFrame,
// which also reads the `/auth/me` profile the page gate uses.
import type { Viewport } from 'next';
import type { ReactNode } from 'react';

import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { AuthedShell } from '@/components/authed-shell';
import { LearnerFrame } from '@/components/learner/learner-frame';
import { AV2_VIEWPORT } from '@/components/ui/theme-color';
import { av2FontClass } from '@/styles/av2/fonts';

export const viewport: Viewport = AV2_VIEWPORT;

export default function CourseLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell design="v2" chrome="none" bodyClass={`av2-root av2-body ${av2FontClass}`}>
      <div className={`av2-root ${av2FontClass}`}>
        <LearnerFrame>{children}</LearnerFrame>
      </div>
    </AuthedShell>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
