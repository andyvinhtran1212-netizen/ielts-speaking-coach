import type { ReactNode } from 'react';
import Script from 'next/script';

import { AuthedShell } from '@/components/authed-shell';

export default function ListeningDictationLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/listening.css', '/css/listening-dictation-next.css']}
      extraScripts={(
        <Script
          type="module"
          src="/js/components/audio-player.js"
          strategy="afterInteractive"
        />
      )}
      bodyClass="av-page listening-dictation-next-page"
    >
      {children}
    </AuthedShell>
  );
}
