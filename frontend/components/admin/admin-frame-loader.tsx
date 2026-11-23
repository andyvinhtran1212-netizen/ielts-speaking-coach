'use client';

// G09-T08: AuthedShell renders this (not AdminFrame) when ADMIN_FRAME_V2=1.
// AdminFrame and its CSS (av2 tokens, StaffShell) are fetched only in the
// browser and only here, so no other route that shares AuthedShell, and no
// admin route with the flag off, links them. The cost: with `ssr: false` the
// page content is a child of AdminFrame, so the server HTML of a flagged admin
// page has no page content at all, and the browser shows nothing until this
// chunk has loaded (then frame and page render together). The old frame never
// shows: the body class already put <aver-admin-chrome> in slot-only mode.
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

const AdminFrame = dynamic(
  () => import('@/components/admin/admin-frame').then((m) => m.AdminFrame),
  { ssr: false, loading: () => null },
);

export function AdminFrameLoader({ children }: { children: ReactNode }) {
  return <AdminFrame>{children}</AdminFrame>;
}
