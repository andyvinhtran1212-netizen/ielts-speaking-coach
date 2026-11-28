import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { requireAdminFrameV2 } from '@/lib/admin-frame-redirect';
import { SOURCES } from '@/lib/admin-incidents-model.mjs';

import { AdminIncidentDetail } from './admin-incident-detail';

export const metadata: Metadata = {
  title: 'Nhóm sự cố · Admin',
  robots: { index: false, follow: false },
};

export default async function AdminIncidentDetailPage(
  { params }: { params: Promise<{ source: string; fingerprint: string }> },
) {
  requireAdminFrameV2();
  const { source, fingerprint } = await params;
  if (!SOURCES.includes(source) || !/^[0-9a-f]{40}$/.test(fingerprint)) notFound();
  return (
    <aver-admin-chrome active="error-logs">
      <AdminAccessGate>
        <AdminIncidentDetail source={source} fingerprint={fingerprint} />
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}
