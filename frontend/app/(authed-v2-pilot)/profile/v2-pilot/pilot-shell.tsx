'use client';

import type { ReactNode } from 'react';

import { LearnerShell } from '@/components/ui/shell/learner-shell';

import { SAMPLE_LEARNER, SampleBell, sampleLookup } from '../../../(ui-library)/ui-library/learner-demo';

/**
 * The pilot's LearnerShell with sample data. The pathname has no learner
 * section (it is a diagnostic route), so no section is marked: that is the
 * real derivation from the registry, not a demo override.
 */
export function PilotLearnerShell({ children }: { children: ReactNode }) {
  return (
    <LearnerShell
      user={SAMPLE_LEARNER}
      canSwitchToAdmin={false}
      credits={{ remaining: null, low: false }}
      notificationsSlot={<SampleBell />}
      lookup={sampleLookup}
    >
      {children}
    </LearnerShell>
  );
}
