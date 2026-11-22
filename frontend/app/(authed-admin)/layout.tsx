import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

// ADMINGROUP-0077: one admin shell for every page in `(authed-admin)`. Child
// groups such as `(feedback)` add only their page stylesheets with plain
// `<link rel="stylesheet">`, which render after these four base sheets (admin
// turns the Tailwind layer off) and unmount with the child group. Never put a
// stylesheet layout on a shared URL segment (`admin/`, `admin/writing/`…):
// it would leak onto every page below it (FR-004).
export default function AdminLayout({ children }: { children: ReactNode }) {
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
        '/css/aver-design/admin-status.css',
      ]}
    >
      {children}
    </AuthedShell>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
