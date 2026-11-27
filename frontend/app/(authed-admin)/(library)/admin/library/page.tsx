import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminLibrary } from './admin-library';

export const metadata: Metadata = {
  title: 'Thư viện công khai · Admin',
  robots: { index: false, follow: false },
};

// LIBRARY-0061 T020 (G06-T20). The G09 sidebar entry is not on staging yet
// (admin-nav-registry, G09-T08), so the chrome highlights no section here.
export default function AdminLibraryPage() {
  return <aver-admin-chrome active="library"><AdminAccessGate><AdminLibrary /></AdminAccessGate></aver-admin-chrome>;
}
