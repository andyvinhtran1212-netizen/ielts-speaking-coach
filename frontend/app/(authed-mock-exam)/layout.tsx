import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function MockExamLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/mock-exam-next.css']}
      extraScripts={<script src="/js/speaking-debt.js" defer />}
      chrome="none"
      bodyClass="mock-exam-next-page"
    >
      {children}
    </AuthedShell>
  );
}
