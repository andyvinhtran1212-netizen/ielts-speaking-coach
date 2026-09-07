import type { ReactNode } from 'react';
import Script from 'next/script';

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
      extraScripts={<Script src="/js/writing-renderers.js" strategy="afterInteractive" />}
    >
      {children}
    </AuthedShell>
  );
}
