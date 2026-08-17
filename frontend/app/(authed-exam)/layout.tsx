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
