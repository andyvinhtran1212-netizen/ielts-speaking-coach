import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';
import { RouteScriptChain } from '@/components/route-script-chain';

export default function ReadingPlayerLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={[
        '/css/reading-exam-mockup.css',
        '/css/reading-exam.css',
        '/css/reading-exam-next.css',
        '/css/exam-result-next.css',
        '/css/mock-post-test-capture.css',
      ]}
      extraScripts={<RouteScriptChain scripts={[
        { src: '/vendor/marked.min.js' },
        { src: '/vendor/purify.min.js' },
        { src: '/js/markdown.js' },
        { src: '/js/mock-exam-hook.js' },
      ]} />}
      utilityLayer={false}
      bodyClass="exam-chrome reading-next-player-page"
    >
      {children}
    </AuthedShell>
  );
}
