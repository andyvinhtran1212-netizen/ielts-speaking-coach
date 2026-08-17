import type { Metadata } from 'next';
import { Suspense } from 'react';

import { MockExamRunner, MockExamRunnerLoading } from './mock-exam-runner';

export const metadata: Metadata = {
  title: 'Thi thử IELTS 4 kỹ năng — Aver Learning',
  robots: { index: false, follow: false },
};

export default function MockExamPage() {
  return (
    <Suspense fallback={<MockExamRunnerLoading />}>
      <MockExamRunner />
    </Suspense>
  );
}
