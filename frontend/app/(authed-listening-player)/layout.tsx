import type { ReactNode } from 'react';
import Script from 'next/script';

import { AuthedShell } from '@/components/authed-shell';

export default function ListeningPlayerLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={[
        '/css/reading-exam-mockup.css',
        '/css/listening.css',
        '/css/ielts-test-paper.css',
        '/css/listening-test-ui.css',
        '/css/listening-test-next.css',
        '/css/exam-result-next.css',
        '/css/mock-post-test-capture.css',
      ]}
      extraScripts={<Script src="/js/mock-exam-hook.js" strategy="afterInteractive" />}
      utilityLayer={false}
      bodyClass="exam-chrome listening-exam-chrome listening-next-player-page"
    >
      {children}
    </AuthedShell>
  );
}
