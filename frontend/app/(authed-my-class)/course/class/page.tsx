import type { Metadata } from 'next';

import { ClassGate } from './class-gate';

export const metadata: Metadata = {
  title: 'Buổi học và tài liệu lớp · Aver Learning',
  robots: { index: false, follow: false },
};

// LEARNERCORE-0063 amendment 6 (G07-T30c): behind `learner_v2`; flag off
// replaces the URL with /my-class (FR-119).
export default function ClassSessionsPage() {
  return (
    <>
      {/* @ts-ignore -- aver-chrome is the coexistence Web Component. */}
      <aver-chrome active="class" />
      <ClassGate />
    </>
  );
}
