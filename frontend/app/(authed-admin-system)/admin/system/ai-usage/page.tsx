import type { Metadata } from 'next';
import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminAiUsage } from './admin-ai-usage';

export const metadata: Metadata = { title: 'Chi phí AI · Admin', robots: { index: false, follow: false } };

export default function AdminAiUsagePage() {
  return <aver-admin-chrome active="system" subsection="ai-usage"><AdminAccessGate><AdminAiUsage /></AdminAccessGate></aver-admin-chrome>;
}
