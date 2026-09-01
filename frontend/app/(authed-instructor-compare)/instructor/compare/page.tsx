import type { Metadata } from 'next';
import { Suspense } from 'react';

import { InstructorCompare } from './instructor-compare';

export const metadata: Metadata = {
  title: 'So sánh và ghép phiên bản · Aver Learning',
};

export default function InstructorComparePage() {
  return (
    <Suspense fallback={<main className="ic-main"><div className="ic-state" role="status"><span className="ic-spinner" />Đang mở workspace so sánh…</div></main>}>
      <InstructorCompare />
    </Suspense>
  );
}
