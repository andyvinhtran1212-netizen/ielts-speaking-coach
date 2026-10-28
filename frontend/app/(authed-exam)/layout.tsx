import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedExamLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/exam-player-next.css']}
      bodyClass="av-page min-h-screen font-sans antialiased"
    >
      {children}
    </AuthedShell>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
