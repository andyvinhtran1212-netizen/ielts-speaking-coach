import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminFootTraffic } from './admin-foot-traffic';

export const metadata: Metadata = {
  title: 'Lưu lượng truy cập · Admin',
  robots: { index: false, follow: false },
};

export default function AdminFootTrafficPage() {
  return <aver-admin-chrome active="foot-traffic"><AdminAccessGate><AdminFootTraffic /></AdminAccessGate></aver-admin-chrome>;
}
