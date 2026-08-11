import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function ListeningPlayerLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={[
        '/css/listening.css',
        '/css/ielts-test-paper.css',
        '/css/listening-test-ui.css',
        '/css/listening-test-next.css',
      ]}
      extraScripts={<script src="/js/mock-exam-hook.js" defer />}
      utilityLayer={false}
      bodyClass="av-page listening-next-player-page"
    >
      {children}
    </AuthedShell>
  );
}
