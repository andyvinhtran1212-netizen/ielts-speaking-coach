import type { ReactNode } from 'react';
import Script from 'next/script';

import { AuthedShell } from '@/components/authed-shell';

export default function MockExamLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/mock-exam-next.css', '/css/mock-post-test-capture.css']}
      extraScripts={<Script src="/js/speaking-debt.js" strategy="afterInteractive" />}
      chrome="none"
      bodyClass="mock-exam-next-page"
    >
      {children}
    </AuthedShell>
  );
}
