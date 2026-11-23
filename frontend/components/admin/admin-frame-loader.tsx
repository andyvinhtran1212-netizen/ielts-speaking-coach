'use client';

// G09-T08: AuthedShell renders this (not AdminFrame) when ADMIN_FRAME_V2=1.
// AdminFrame and its CSS (av2 tokens, StaffShell) are fetched only in the
// browser and only here, so no other route that shares AuthedShell, and no
// admin route with the flag off, links them. Until the chunk arrives the page
// content renders without a frame (never under the old one: the body class
// already put <aver-admin-chrome> in slot-only mode).
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

const AdminFrame = dynamic(
  () => import('@/components/admin/admin-frame').then((m) => m.AdminFrame),
  { ssr: false, loading: () => null },
);

export function AdminFrameLoader({ children }: { children: ReactNode }) {
  return <AdminFrame>{children}</AdminFrame>;
}
