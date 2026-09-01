import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function ListeningDictationLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/listening.css', '/css/listening-dictation-next.css']}
      extraScripts={<script type="module" src="/js/components/audio-player.js" />}
      bodyClass="av-page listening-dictation-next-page"
    >
      {children}
    </AuthedShell>
  );
}
