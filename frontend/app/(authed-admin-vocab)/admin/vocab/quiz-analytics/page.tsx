import type { Metadata } from 'next';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminVocabQuizAnalytics } from './admin-vocab-quiz-analytics';

export const metadata: Metadata = {
  title: 'Kết quả Quick-Check · Admin',
  robots: { index: false, follow: false },
};

export default function AdminVocabQuizAnalyticsPage() {
  return (
    <aver-admin-chrome active="vocab" subsection="quiz-analytics">
      <AdminAccessGate><AdminVocabQuizAnalytics /></AdminAccessGate>
    </aver-admin-chrome>
  );
}

