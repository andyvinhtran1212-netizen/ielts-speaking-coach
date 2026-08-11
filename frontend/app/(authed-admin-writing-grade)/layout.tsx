import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

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
      extraScripts={
        <>
          <script src="/js/toast.js" defer />
          <script src="/js/writing-renderers.js" defer />
          <script src="/js/image-lightbox.js" defer />
        </>
      }
    >
      {children}
    </AuthedShell>
  );
}
