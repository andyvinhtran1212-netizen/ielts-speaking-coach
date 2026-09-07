import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';
import { RouteScriptChain } from '@/components/route-script-chain';

export default function ReadingReviewLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={[
        '/css/markdown.css',
        '/css/reading-exam-mockup.css',
        '/css/reading-review.css',
        '/css/feedback.css',
        '/css/reading-review-next.css',
      ]}
      extraScripts={<RouteScriptChain scripts={[
        { src: 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js' },
        { src: 'https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js' },
        { src: '/js/markdown.js' },
        { src: '/js/feedback-widgets.js' },
      ]} />}
      utilityLayer={false}
      chrome="none"
      authGated={false}
      bodyClass="exam-chrome"
    >
      {children}
    </AuthedShell>
  );
}
