import type { Metadata } from 'next';

import { LEGAL_ROBOTS, TERMS } from '../legal-content';
import { LegalDocument } from '../legal-document';

export const metadata: Metadata = {
  title: 'Điều khoản — Aver Learning',
  description: 'Điều khoản sử dụng Aver Learning (bản tạm, đang chờ duyệt pháp lý).',
  alternates: { canonical: '/terms' },
  robots: LEGAL_ROBOTS,
};

export default function TermsPage() {
  return <LegalDocument doc={TERMS} />;
}
