import type { ReactNode } from 'react';

// ADMINGROUP-0077: the admin shell and base sheets come from (authed-admin)/layout.tsx.
export default function AdminOverviewLayout({ children }: { children: ReactNode }) {
  const todo = process.env.ADMIN_FRAME_V2 === '1';
  return (
    <>
      <link rel="stylesheet" href="/css/aver-design/admin-hub.css" />
      <link rel="stylesheet" href="/css/admin-overview.css" />
      {todo ? <link rel="stylesheet" href="/css/admin-todo-next.css" /> : null}
      {children}
    </>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
