import type { ReactNode } from 'react';

// ADMINGROUP-0077: the admin shell and base sheets come from (authed-admin)/layout.tsx.
// admin-classes-next.css carries the shared dialog and form styles (acd-*).
export default function AdminCreditsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href="/css/admin-classes-next.css" />
      <link rel="stylesheet" href="/css/admin-credits-next.css" />
      {children}
    </>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
