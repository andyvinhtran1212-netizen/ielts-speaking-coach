import type { ReactNode } from 'react';
import { AuthedShell } from '@/components/authed-shell';
import { RouteScriptChain } from '@/components/route-script-chain';

export default function AdminWritingTipsLayout({ children }: { children: ReactNode }) {
  return <AuthedShell chrome="admin" bodyClass="av-page av-admin-surface" utilityLayer={false} tailwindLayer={false} pageStylesheets={[
    { href: '/css/aver-design/admin-surface.css', dataAverAdminSurface: true },
    '/css/aver-design/admin-components.css', '/css/aver-design/admin-buttons.css', '/css/aver-design/admin-status.css', '/css/markdown.css', '/css/admin-writing-tips-next.css',
  ]} extraScripts={<RouteScriptChain scripts={[
    { src: 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js' },
    { src: 'https://cdn.jsdelivr.net/npm/dompurify@3.4.8/dist/purify.min.js' },
    { src: '/js/markdown.js' },
  ]} />}>{children}</AuthedShell>;
}
