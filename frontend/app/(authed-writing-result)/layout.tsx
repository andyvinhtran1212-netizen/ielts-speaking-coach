import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

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
      extraScripts={
        <>
          <script src="/js/image-lightbox.js" defer />
          <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js" defer />
          <script src="https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js" defer />
          <script src="/js/markdown.js" defer />
          <script src="/js/writing-renderers.js" defer />
          <script src="/js/writing-highlight.js" defer />
        </>
      }
    >
      {children}
    </AuthedShell>
  );
}
