import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminUsage } from './admin-usage';

export const metadata: Metadata = {
  title: 'Hoạt động người dùng · Admin',
  robots: { index: false, follow: false },
};

export default function AdminUsagePage() {
  return <aver-admin-chrome active="usage"><AdminAccessGate><AdminUsage /></AdminAccessGate></aver-admin-chrome>;
}
