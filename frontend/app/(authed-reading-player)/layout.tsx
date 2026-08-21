import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function ReadingPlayerLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={[
        '/css/reading-exam-mockup.css',
        '/css/reading-exam.css',
        '/css/reading-exam-next.css',
        '/css/exam-result-next.css',
      ]}
      extraScripts={
        <>
          <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js" defer />
          <script src="https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js" defer />
          <script src="/js/markdown.js" defer />
          <script src="/js/mock-exam-hook.js" defer />
        </>
      }
      utilityLayer={false}
      bodyClass="exam-chrome reading-next-player-page"
    >
      {children}
    </AuthedShell>
  );
}
