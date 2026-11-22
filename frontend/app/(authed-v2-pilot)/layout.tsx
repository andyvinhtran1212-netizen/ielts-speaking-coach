// UIBASE-0056 G03-T12: the first layout on the "Bản in" tree. It exists to
// prove the coexistence contract (plan 5.7) on a diagnostic page; from G03-T14
// it also hosts LearnerShell with sample data. Removed with its page when G07
// puts the first real learner page on LearnerShell.
import type { ReactNode } from 'react';

import '@/styles/av2/tokens.css';
import '@/styles/av2/base.css';
import { AuthedShell } from '@/components/authed-shell';
import { av2FontClass } from '@/styles/av2/fonts';

export default function V2PilotLayout({ children }: { children: ReactNode }) {
  // The page is diagnostic and static (its gate needs a real 404), so it does
  // not require a session; the shell still mounts the runtime boundary and
  // AuthProvider exactly as a signed-in v2 page will.
  return (
    <AuthedShell design="v2" chrome="none" authGated={false}>
      <div className={`av2-root ${av2FontClass}`}>{children}</div>
    </AuthedShell>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
