import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function FullTestResultLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell pageStylesheets={['/css/full-test-result.css']}>
      {children}
    </AuthedShell>
  );
}
