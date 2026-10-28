import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function D1ExerciseLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/d1-exercise-next.css']}>
      {children}
    </AuthedShell>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
