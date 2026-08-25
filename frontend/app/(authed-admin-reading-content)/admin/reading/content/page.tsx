import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminReadingContent } from './admin-reading-content';

export const metadata: Metadata = {
  title: 'Nội dung Reading · Admin',
  description: 'Import, kiểm định và vận hành thư viện Reading.',
  robots: { index: false, follow: false },
};

export default function AdminReadingContentPage() {
  return <aver-admin-chrome active="reading" subsection="content"><AdminAccessGate><AdminReadingContent /></AdminAccessGate></aver-admin-chrome>;
}
