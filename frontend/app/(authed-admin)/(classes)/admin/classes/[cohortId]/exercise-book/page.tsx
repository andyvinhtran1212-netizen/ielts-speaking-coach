import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminAccessGate } from '@/components/admin-access-gate';
import { AdminExerciseBook } from '@/components/exercise-book/admin-exercise-book';
import { ExerciseBookApiProvider } from '@/lib/exercise-book/api-context';

export const metadata: Metadata = {
  title: 'Sách bài tập · Admin',
  robots: { index: false, follow: false },
};

async function AdminExerciseBookRoute({ params }: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await params;
  return (
    <aver-admin-chrome active="classes" subsection="classes">
      <AdminAccessGate>
        <main className="acd-shell acx-shell">
          <nav className="acx-breadcrumb" aria-label="Đường dẫn"><a href={`/admin/classes/${encodeURIComponent(cohortId)}`}>Về lớp</a></nav>
          <h1>Sách bài tập Listening</h1>
          <ExerciseBookApiProvider><AdminExerciseBook cohortId={cohortId} /></ExerciseBookApiProvider>
        </main>
      </AdminAccessGate>
    </aver-admin-chrome>
  );
}

export default function AdminExerciseBookPage({ params }: { params: Promise<{ cohortId: string }> }) {
  return (
    <Suspense fallback={<main className="acd-shell"><div className="acd-state" role="status">Đang mở sách bài tập…</div></main>}>
      <AdminExerciseBookRoute params={params} />
    </Suspense>
  );
}
