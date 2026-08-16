import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function MyClassLayout({ children }: { children: ReactNode }) {
  return (
    <AuthedShell
      pageStylesheets={['/css/my-class-base.css', '/css/my-class.css']}
      utilityLayer={false}
      extraScripts={(
        <>
          <script src="/js/toast.js" defer />
          <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js" defer />
          <script src="https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js" defer />
          <script src="/js/markdown.js" defer />
        </>
      )}
    >
      {children}
    </AuthedShell>
  );
}
