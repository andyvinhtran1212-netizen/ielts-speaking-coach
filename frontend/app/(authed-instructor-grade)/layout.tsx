import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';
import { RouteScriptChain } from '@/components/route-script-chain';

export default function InstructorGradeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      chrome="none"
      utilityLayer={false}
      tailwindLayer={false}
      bodyClass="av-page"
      pageStylesheets={[
        '/css/writing-renderers.css',
        '/css/writing-highlight.css',
        '/css/instructor-grade-next.css',
      ]}
      extraScripts={<RouteScriptChain scripts={[
        { src: '/js/writing-renderers.js' },
        { src: '/js/writing-highlight.js' },
      ]} />}
    >
      {children}
    </AuthedShell>
  );
}
