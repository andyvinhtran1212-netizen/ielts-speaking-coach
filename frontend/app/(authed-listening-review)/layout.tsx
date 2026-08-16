import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function ListeningReviewLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={[
        '/css/markdown.css',
        '/css/reading-exam-mockup.css',
        '/css/listening-review.css',
        '/css/feedback.css',
        '/css/listening-review-next.css',
      ]}
      extraScripts={
        <>
          <script type="module" src="/js/components/audio-player.js" />
          <script src="/js/feedback-widgets.js" defer />
        </>
      }
      utilityLayer={false}
      chrome="none"
      bodyClass="exam-chrome"
    >
      {children}
    </AuthedShell>
  );
}
