import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminFeedback } from './admin-feedback';

export const metadata: Metadata = {
  title: 'Phản hồi người học · Admin',
  robots: { index: false, follow: false },
};

export default function AdminFeedbackPage() {
  return <aver-admin-chrome active="feedback"><AdminAccessGate><AdminFeedback /></AdminAccessGate></aver-admin-chrome>;
}
