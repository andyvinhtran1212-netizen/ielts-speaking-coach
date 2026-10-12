import type { Metadata } from 'next';
import { Suspense } from 'react';

import { MockExamRunner, MockExamRunnerLoading } from './mock-exam-runner';

export const metadata: Metadata = {
  title: 'IELTS Mock Test - Aver Learning',
  robots: { index: false, follow: false },
};

export default function MockExamPage() {
  return (
    <div lang="en" style={{ display: 'contents' }}>
      <Suspense fallback={<MockExamRunnerLoading />}>
        <MockExamRunner />
      </Suspense>
    </div>
  );
}
