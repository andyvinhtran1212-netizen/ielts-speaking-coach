import { redirect } from 'next/navigation';

export const metadata = { title: 'Exercises — Aver Learning', robots: { index: false, follow: false } };

// Legacy entry remains valid; drills/history now live in the persistent Review
// workspace. The D1 player and its existing evidence keep their own routes.
export default function ExercisesPage() {
  redirect('/vocabulary/hub?view=review');
}
