import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminListeningContent } from './admin-listening-content';

export const metadata: Metadata = {
  title: 'Nội dung Listening · Admin',
  description: 'Kiểm định trạng thái nội dung, audio và exercise của thư viện Listening.',
  robots: { index: false, follow: false },
};

export default function AdminListeningPage() {
  return <aver-admin-chrome active="listening" subsection="content"><AdminAccessGate><AdminListeningContent /></AdminAccessGate></aver-admin-chrome>;
}
