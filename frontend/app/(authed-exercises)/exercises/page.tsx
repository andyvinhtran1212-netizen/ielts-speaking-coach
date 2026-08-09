// Trang Exercises trên Next — `/exercises`.
import type { Metadata } from 'next';

import { ExercisesBehavior } from './exercises-behavior';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Exercises — Aver Learning',
  robots: { index: false, follow: false },
};

export default function ExercisesPage() {
  return (
    <>
      {/* Chrome chung. Layout chỉ NẠP script; phần tử phải do từng trang dựng. */}
      {/* @ts-ignore */}
      <aver-chrome active="vocabulary" />
      <ExercisesBehavior />
    </>
  );
}
