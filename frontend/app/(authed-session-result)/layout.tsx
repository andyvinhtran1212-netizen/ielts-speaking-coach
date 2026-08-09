import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function SessionResultLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/result.css']}
      extraScripts={<script src="/js/pronunciation-drilldown.js" defer />}
    >
      {children}
    </AuthedShell>
  );
}
