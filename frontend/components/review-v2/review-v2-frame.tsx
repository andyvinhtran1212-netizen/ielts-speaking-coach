'use client';

// The review pages' new frame (LEARNERCORE-0063 FR-104), loaded lazily by
// `review-v2-shell.tsx` only when the account's flag is on, so the old tree
// gets none of its CSS. The workspace inside keeps its own stylesheets (the
// layout is a server component and cannot read the flag); the G03 components
// set their own colours, as on /home (T14).
import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import './review-v2.css';

import type { ReactNode } from 'react';

import { LearnerShell } from '@/components/ui/shell/learner-shell';
import type { LearnerUser } from '@/components/ui/shell/account-menu';

import { REVIEW_V2_ON, ReviewV2Context } from './review-v2-context';

export default function ReviewV2Frame({ learner, isAdmin, children }: {
  learner: LearnerUser;
  isAdmin: boolean;
  children: ReactNode;
}) {
  return (
    <ReviewV2Context.Provider value={REVIEW_V2_ON}>
      <div className="av2-root rv2-root">
        <LearnerShell user={learner} canSwitchToAdmin={isAdmin}>
          {children}
        </LearnerShell>
      </div>
    </ReviewV2Context.Provider>
  );
}
