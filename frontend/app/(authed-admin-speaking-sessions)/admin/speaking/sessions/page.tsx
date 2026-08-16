import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminSpeakingSessions } from './admin-speaking-sessions';

export const metadata: Metadata = { title: 'Sessions Speaking · Admin', robots: { index: false, follow: false } };

export default function AdminSpeakingSessionsPage() {
  return <aver-admin-chrome active="speaking" subsection="sessions"><AdminAccessGate><AdminSpeakingSessions /></AdminAccessGate></aver-admin-chrome>;
}
