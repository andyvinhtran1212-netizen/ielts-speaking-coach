import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

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
      extraScripts={
        <>
          <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js" defer />
          <script src="https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js" defer />
          <script src="/js/markdown.js" defer />
          <script src="/js/feedback-widgets.js" defer />
        </>
      }
      utilityLayer={false}
      chrome="none"
      authGated={false}
      bodyClass="exam-chrome"
    >
      {children}
    </AuthedShell>
  );
}
