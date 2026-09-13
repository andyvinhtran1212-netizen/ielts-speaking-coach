import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';
import { RouteScriptChain } from '@/components/route-script-chain';

export default function MyClassLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/my-class-base.css', '/css/my-class.css']}
      utilityLayer={false}
      extraScripts={<RouteScriptChain scripts={[
        { src: '/js/toast.js' },
        { src: '/vendor/marked.min.js' },
        { src: '/vendor/purify.min.js' },
        { src: '/js/markdown.js' },
      ]} />}
    >
      {children}
    </AuthedShell>
  );
}
