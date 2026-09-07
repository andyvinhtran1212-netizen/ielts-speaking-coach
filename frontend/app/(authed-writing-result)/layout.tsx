import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';
import { RouteScriptChain } from '@/components/route-script-chain';

export default function WritingResultLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      bodyClass="av-page"
      utilityLayer={false}
      pageStylesheets={[
        '/css/writing-renderers.css',
        '/css/writing-result.css',
        '/css/writing-highlight.css',
        '/css/image-lightbox.css',
        '/css/markdown.css',
      ]}
      extraScripts={<RouteScriptChain scripts={[
        { src: '/js/image-lightbox.js' },
        { src: 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js' },
        { src: 'https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js' },
        { src: '/js/markdown.js' },
        { src: '/js/writing-renderers.js' },
        { src: '/js/writing-highlight.js' },
      ]} />}
    >
      {children}
    </AuthedShell>
  );
}
