import type { ReactNode } from 'react';

// ADMINGROUP-0077: the admin shell and base sheets come from (authed-admin)/layout.tsx.
export default function AdminWritingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href="/css/admin-writing-hub-next.css" />
      {children}
    </>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
