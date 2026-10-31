import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AdminMfaLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      chrome="admin"
      bodyClass="av-page av-admin-surface"
      utilityLayer={false}
      tailwindLayer={false}
      pageStylesheets={[
        { href: '/css/aver-design/admin-surface.css', dataAverAdminSurface: true },
        '/css/aver-design/admin-components.css',
        '/css/aver-design/admin-buttons.css',
        '/css/admin-mfa-next.css',
      ]}
    >
      {children}
    </AuthedShell>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
