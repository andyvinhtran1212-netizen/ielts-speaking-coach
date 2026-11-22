import type { Metadata } from 'next';

import { LEGAL_ROBOTS, PRIVACY } from '../legal-content';
import { LegalDocument } from '../legal-document';

export const metadata: Metadata = {
  title: 'Quyền riêng tư — Aver Learning',
  description: 'Chính sách quyền riêng tư của Aver Learning (bản tạm, đang chờ duyệt pháp lý).',
  alternates: { canonical: '/privacy' },
  robots: LEGAL_ROBOTS,
};

export default function PrivacyPage() {
  return <LegalDocument doc={PRIVACY} />;
}
