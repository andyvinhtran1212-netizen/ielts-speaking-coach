import type { ReactNode } from 'react';

import { AuthedShell } from '@/components/authed-shell';

export default function AdminReadingPreviewLayout({ children }: { children: ReactNode }) {
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
      '/css/markdown.css',
      '/css/admin-reading-preview-next.css',
    ]}
    extraScripts={<><script src="https://cdn.jsdelivr.net/npm/marked@13.0.0/marked.min.js" defer/><script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.5/dist/purify.min.js" defer/><script src="/js/markdown.js" defer/></>}
  >{children}</AuthedShell>;
}
