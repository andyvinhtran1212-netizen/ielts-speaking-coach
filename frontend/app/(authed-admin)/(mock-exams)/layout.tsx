import type { ReactNode } from 'react';

// ADMINGROUP-0077: the admin shell and base sheets come from (authed-admin)/layout.tsx.
export default function AdminMockExamsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href="/css/admin-mock-exams-next.css" />
      <link rel="stylesheet" href="/css/admin-exam-ops-next.css" />
      <link rel="stylesheet" href="/css/admin-mock-corrections.css" />
      {children}
    </>
  );
}

// Per-request render for the CSP nonce (PC-J38); see components/authed-shell.tsx.
export const instant = false;
