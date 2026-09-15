import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AdvancedVocabularyLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={[
        '/css/flashcard-study-next.css',
        '/css/advanced-vocab-lesson.css',
      ]}
      bodyClass="av-page fcs-page font-sans min-h-screen"
    >
      {children}
    </AuthedShell>
  );
}
