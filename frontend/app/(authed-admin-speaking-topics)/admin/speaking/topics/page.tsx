import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminSpeakingTopics } from './admin-speaking-topics';

export const metadata: Metadata = { title: 'Topics Speaking · Admin', robots: { index: false, follow: false } };

export default function AdminSpeakingTopicsPage() {
  return <aver-admin-chrome active="speaking" subsection="topics"><AdminAccessGate><AdminSpeakingTopics /></AdminAccessGate></aver-admin-chrome>;
}
