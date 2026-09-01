import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AuthedOnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/onboarding.css']}
      bodyClass="av-page font-sans antialiased flex flex-col min-h-screen"
    >
      {children}
    </AuthedShell>
  );
}
