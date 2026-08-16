import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function InstructorLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      chrome="none"
      utilityLayer={false}
      tailwindLayer={false}
      bodyClass="av-page"
      pageStylesheets={['/css/instructor-next.css']}
    >
      {children}
    </AuthedShell>
  );
}
