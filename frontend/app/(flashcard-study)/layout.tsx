import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function FlashcardStudyLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/flashcard-study-next.css']}
      authGated={false}
      bodyClass="fcs-page font-sans min-h-screen"
    >
      {children}
    </AuthedShell>
  );
}
