import type { Metadata } from 'next';

import { ExerciseBookAssignments } from '@/components/exercise-book/exercise-book-assignments';
import { ExerciseBookApiProvider } from '@/lib/exercise-book/api-context';

export const metadata: Metadata = { title: 'Sách bài tập — Aver Learning', robots: { index: false, follow: false } };

export default function ExerciseBookAssignmentsPage() {
  return <ExerciseBookApiProvider><ExerciseBookAssignments /></ExerciseBookApiProvider>;
}
