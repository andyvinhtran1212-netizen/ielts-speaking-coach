import type { ReactNode } from 'react';
import Script from 'next/script';

import { AuthedShell } from '@/components/authed-shell';

export default function ListeningPracticeRunLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/listening.css', '/css/listening-practice-run-next.css']}
      extraScripts={(
        <Script
          type="module"
          src="/js/components/audio-player.js"
          strategy="afterInteractive"
        />
      )}
      utilityLayer={false}
      bodyClass="av-page listening-practice-run-next-page"
    >
      {children}
    </AuthedShell>
  );
}
