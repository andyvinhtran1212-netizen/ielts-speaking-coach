import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AdminListeningLayout({ children }: { children: ReactNode }) {
  return <AuthedShell
    chrome="admin"
    bodyClass="av-page av-admin-surface"
    utilityLayer={false}
    tailwindLayer={false}
    pageStylesheets={[
      { href: '/css/aver-design/admin-surface.css', dataAverAdminSurface: true },
      '/css/aver-design/components.css',
      '/css/aver-design/admin-components.css',
      '/css/aver-design/admin-buttons.css',
      '/css/aver-design/admin-status.css',
      '/css/admin-listening-content-next.css',
      '/css/admin-listening-content-editor-next.css',
      '/css/admin-listening-tests-next.css',
      '/css/admin-listening-test-detail-next.css',
      '/css/admin-listening-attempts-next.css',
      '/css/admin-listening-dictation-next.css',
      '/css/admin-listening-segments-next.css',
      '/css/admin-listening-gist-next.css',
      '/css/admin-listening-true-false-next.css',
      '/css/admin-listening-mcq-next.css',
    ]}
  >{children}</AuthedShell>;
}
