import type { Metadata } from 'next';
import { Suspense } from 'react';

import { InstructorGrade } from './instructor-grade';

export const metadata: Metadata = {
  title: 'Chấm bài Writing · Aver Learning',
};

export default function InstructorGradePage() {
  return (
    <Suspense fallback={<main className="ig-main"><div className="ig-state" role="status"><span className="ig-spinner" />Đang mở bài chấm…</div></main>}>
      <InstructorGrade />
    </Suspense>
  );
}
