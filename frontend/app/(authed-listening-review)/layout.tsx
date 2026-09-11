import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';
import { RouteScriptChain } from '@/components/route-script-chain';

export default function ListeningReviewLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={[
        '/css/markdown.css',
        '/css/reading-exam-mockup.css',
        '/css/listening-review.css',
        '/css/feedback.css',
        '/css/listening-review-next.css',
        '/css/web-explanation-panel.css',
      ]}
      extraScripts={<RouteScriptChain scripts={[
        { src: '/js/components/audio-player.js', type: 'module' },
        { src: '/js/feedback-widgets.js' },
      ]} />}
      utilityLayer={false}
      chrome="none"
      bodyClass="exam-chrome"
    >
      {children}
    </AuthedShell>
  );
}
