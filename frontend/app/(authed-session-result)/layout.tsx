import type { ReactNode } from 'react';
import Script from 'next/script';

import { AuthedShell } from '@/components/authed-shell';

export default function SessionResultLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/result.css']}
      extraScripts={(
        <Script
          src="/js/pronunciation-drilldown.js"
          strategy="afterInteractive"
        />
      )}
    >
      {children}
    </AuthedShell>
  );
}
