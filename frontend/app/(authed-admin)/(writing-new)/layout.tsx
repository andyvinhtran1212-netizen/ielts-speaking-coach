import type { ReactNode } from 'react';

// ADMINGROUP-0077: the admin shell and base sheets come from (authed-admin)/layout.tsx.
export default function AdminWritingNewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href="/css/admin-writing-new-next.css" />
      {children}
    </>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
