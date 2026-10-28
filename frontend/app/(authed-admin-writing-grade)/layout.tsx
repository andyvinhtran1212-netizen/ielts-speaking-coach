import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';
import { RouteScriptChain } from '@/components/route-script-chain';

export default function AdminWritingGradeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      chrome="admin"
      bodyClass="av-page font-sans antialiased av-admin-surface"
      utilityLayer={false}
      tailwindLayer
      pageStylesheets={[
        {
          href: '/css/aver-design/admin-surface.css',
          dataAverAdminSurface: true,
        },
        '/css/admin-writing.css',
        '/css/admin-writing-grade.css',
        '/css/image-lightbox.css',
      ]}
      extraScripts={<RouteScriptChain scripts={[
        { src: '/js/toast.js' },
        { src: '/js/writing-renderers.js' },
        { src: '/js/image-lightbox.js' },
      ]} />}
    >
      {children}
    </AuthedShell>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
