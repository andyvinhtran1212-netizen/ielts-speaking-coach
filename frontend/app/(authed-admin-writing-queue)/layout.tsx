import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AdminWritingQueueLayout({ children }: { children: ReactNode }) {
  return <AuthedShell chrome="admin" bodyClass="av-page av-admin-surface" utilityLayer={false} tailwindLayer={false} pageStylesheets={[
    { href: '/css/aver-design/admin-surface.css', dataAverAdminSurface: true },
    '/css/aver-design/admin-components.css', '/css/aver-design/admin-buttons.css', '/css/aver-design/admin-status.css',
    '/css/admin-writing-queue-next.css',
  ]}>{children}</AuthedShell>;
}
