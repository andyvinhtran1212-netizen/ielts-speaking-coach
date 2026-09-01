import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function InstructorCompareLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      chrome="none"
      utilityLayer={false}
      tailwindLayer={false}
      bodyClass="av-page"
      pageStylesheets={[
        '/css/writing-renderers.css',
        '/css/instructor-compare-next.css',
      ]}
      extraScripts={<script src="/js/writing-renderers.js" defer />}
    >
      {children}
    </AuthedShell>
  );
}
