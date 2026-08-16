import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function InstructorGradeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      chrome="none"
      utilityLayer={false}
      tailwindLayer={false}
      bodyClass="av-page"
      pageStylesheets={[
        '/css/writing-renderers.css',
        '/css/writing-highlight.css',
        '/css/instructor-grade-next.css',
      ]}
      extraScripts={(
        <>
          <script src="/js/writing-renderers.js" defer />
          <script src="/js/writing-highlight.js" defer />
        </>
      )}
    >
      {children}
    </AuthedShell>
  );
}
